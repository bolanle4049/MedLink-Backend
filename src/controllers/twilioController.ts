import { Request, Response } from "express";
import { createClient } from "redis";
import { PrismaClient } from "@prisma/client";
import { checkRedFlags } from "../services/redFlagEngine";
import { processPatientTurn } from "../services/aiIntake";
import { RoutingEngine, CoverageCase } from "../services/routingEngine";
import { ListBasedHMOAdapter } from "../services/hmoAdapter";

const prisma = new PrismaClient();
const redisClient = createClient();
redisClient.connect().catch(console.error);

export async function webhook(req: Request, res: Response): Promise<void> {
  const fromPhone = req.body.From || req.body.from;
  const body = (req.body.Body || req.body.body || "").trim();
  const waMessageId = req.body.MessageSid || req.body.SmsMessageSid;

  if (!fromPhone || !body) {
    res.status(400).send("Missing From or Body form field");
    return;
  }

  // Deduplication using Redis
  if (waMessageId) {
    const isDuplicate = await redisClient.get(`msg_dedup:${waMessageId}`);
    if (isDuplicate) {
      res.status(200).send("<Response></Response>"); // Ignore duplicate
      return;
    }
    await redisClient.setEx(`msg_dedup:${waMessageId}`, 3600, "processed");
  }

  const replyMessage = await processInboundMessage(
    fromPhone,
    body,
    waMessageId || "simulated",
  );

  res.set("Content-Type", "application/xml");
  res
    .status(200)
    .send(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXML(replyMessage)}</Message></Response>`,
    );
}

function escapeXML(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "\\":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });
}

async function processInboundMessage(
  fromPhone: string,
  body: string,
  waMessageId: string,
): Promise<string> {
  console.log(`[TWILIO INBOUND] Phone: ${fromPhone} | Message: ${body}`);

  // 1. Get or Create Contact
  let contact = await prisma.contact.findUnique({
    where: { waPhone: fromPhone },
  });
  if (!contact) {
    contact = await prisma.contact.create({ data: { waPhone: fromPhone } });
  } else {
    await prisma.contact.update({
      where: { id: contact.id },
      data: { lastSeen: new Date() },
    });
  }

  // 2. Get Active Episode
  let activeEpisode = await prisma.episode.findFirst({
    where: {
      contactId: contact.id,
      status: { notIn: ["resolved", "needs_visit", "pending_followup"] },
    },
    include: { messages: true, patient: true },
  });

  if (!activeEpisode) {
    activeEpisode = await prisma.episode.create({
      data: {
        contactId: contact.id,
        status: "awaiting_consent",
        reporterRelationship: "unknown",
      },
      include: { messages: true, patient: true },
    });
  }

  // 3. Save Message
  await prisma.message.create({
    data: {
      episodeId: activeEpisode.id,
      direction: "inbound",
      body,
      waMessageId,
    },
  });

  // 4. Red Flag Check (Runs before any state processing)
  const redFlagCheck = checkRedFlags({
    message: body,
    age: activeEpisode.subjectAge || undefined,
    sex: activeEpisode.subjectSex || undefined,
  });

  if (redFlagCheck.isCritical) {
    await prisma.episode.update({
      where: { id: activeEpisode.id },
      data: {
        isCritical: true,
        triageBand: "critical",
        status: "queued",
        queuedAt: new Date(),
      },
    });

    return `⚠️ URGENT MEDICAL WARNING: Your reported symptoms indicate a critical condition. Please go to the nearest emergency clinic or hospital immediately. A doctor has been alerted.`;
  }

  // 5. State Machine
  switch (activeEpisode.status) {
    case "awaiting_consent":
      if (
        body.toLowerCase().includes("yes") ||
        body.toLowerCase().includes("agree") ||
        body.toLowerCase() === "y"
      ) {
        await prisma.consent.create({
          data: { contactId: contact.id, scope: "ndpa_triage" },
        });
        await prisma.episode.update({
          where: { id: activeEpisode.id },
          data: { status: "identifying" },
        });
        return "Thank you for your consent. Who are you reporting these symptoms for? (Reply with: 1 for Me, 2 for My Child, 3 for Another Adult)";
      } else if (
        body.toLowerCase().includes("no") ||
        body.toLowerCase() === "n"
      ) {
        await prisma.episode.update({
          where: { id: activeEpisode.id },
          data: { status: "resolved", outcome: "consent_denied" },
        });
        return "We understand. Your session has been ended. Stay safe.";
      } else {
        return "MedLink AI uses your data to triage symptoms securely under NDPA. Do you consent? (Yes/No)";
      }

    case "identifying":
      if (activeEpisode.reporterRelationship === "unknown") {
        let relationship = "me";
        if (body.includes("2") || body.toLowerCase().includes("child"))
          relationship = "child";
        if (body.includes("3") || body.toLowerCase().includes("other"))
          relationship = "other_adult";

        await prisma.episode.update({
          where: { id: activeEpisode.id },
          data: { reporterRelationship: relationship },
        });
        return "Got it. Please tell me the patient's age and sex (e.g., '35 years old male').";
      } else if (!activeEpisode.subjectAge || !activeEpisode.subjectSex) {
        // Very basic age/sex parsing
        const ageMatch = body.match(
          /\b(\d{1,3})\s*(years|yr|yrs|months|old)?\b/i,
        );
        const age = ageMatch ? parseInt(ageMatch[1], 10) : null;
        let sex = null;
        if (
          body.toLowerCase().includes("male") ||
          body.toLowerCase().includes("man") ||
          body.toLowerCase().includes("boy")
        )
          sex = "Male";
        if (
          body.toLowerCase().includes("female") ||
          body.toLowerCase().includes("woman") ||
          body.toLowerCase().includes("girl")
        )
          sex = "Female";

        if (age && sex) {
          await prisma.episode.update({
            where: { id: activeEpisode.id },
            data: { subjectAge: age, subjectSex: sex, status: "coverage" },
          });
          return "Thank you. Do you have an HMO number or a Hospital Card? Please reply with your HMO ID (e.g., HMO1234), or 'Card', or 'None'.";
        } else {
          return "I couldn't quite catch the age and sex. Could you please provide them clearly? (e.g., 25 female)";
        }
      }
      break;

    case "coverage":
      let coverageCase = CoverageCase.NONE;
      if (body.toLowerCase().startsWith("hmo")) {
        coverageCase = CoverageCase.HMO;
        // Mock HMO validation
        const adapter = new ListBasedHMOAdapter("RelianceHMO");
        const hmoRes = await adapter.verifyEnrollee(body);

        await prisma.enrolleeVerification.create({
          data: {
            episodeId: activeEpisode.id,
            hmoId: "dummy-hmo-id", // Assuming pre-seeded HMO in DB
            valid: hmoRes.valid,
            enrolleeId: hmoRes.enrolleeId,
            enrolleeName: hmoRes.patientName,
            planTier: hmoRes.planTier || "unknown",
            homeFacilityId: hmoRes.homeFacilityId,
            coverageStatus: hmoRes.coverageStatus,
            verificationMethod: hmoRes.verificationMethod,
          },
        });
      } else if (body.toLowerCase().includes("card")) {
        coverageCase = CoverageCase.CARD;
      }

      await prisma.episode.update({
        where: { id: activeEpisode.id },
        data: { coverageCase, status: "interviewing" },
      });
      return "Understood. Can you describe the primary medical complaint or symptoms that brought you here today?";

    case "interviewing":
      try {
        const transcriptText = activeEpisode.messages
          .map(
            (m) => `${m.direction === "inbound" ? "Patient" : "AI"}: ${m.body}`,
          )
          .join("\n");

        const intakeRes = await processPatientTurn(
          "Unknown Name", // Can be extracted if needed
          activeEpisode.subjectAge,
          activeEpisode.subjectSex,
          transcriptText,
          body,
        );

        if (intakeRes.isComplete) {
          // Save observations
          for (const obs of intakeRes.observations) {
            await prisma.observation.create({
              data: {
                episodeId: activeEpisode.id,
                sourceMessageId:
                  activeEpisode.messages[activeEpisode.messages.length - 1].id,
                code: obs.code,
                value: obs.value,
                sourceQuote: obs.sourceQuote,
              },
            });
          }

          // Route the episode
          const hmoVerif = await prisma.enrolleeVerification.findUnique({
            where: { episodeId: activeEpisode.id },
          });
          const routeResult = RoutingEngine.determineRoute(
            hmoVerif as any,
            null,
            "Unknown Name",
          );

          await prisma.episode.update({
            where: { id: activeEpisode.id },
            data: {
              status: "queued",
              triageBand: intakeRes.triageBand || "routine",
              queuedAt: new Date(),
              facilityId: routeResult.targetFacilityId,
              identityMismatch: routeResult.identityMismatch,
            },
          });

          return "Thank you for providing these details. I have summarized your case and sent it to the appropriate medical facility. A doctor will review your case and reply to you here shortly.";
        } else {
          return intakeRes.nextQuestion;
        }
      } catch (err) {
        console.error(err);
        return "I apologize, I am having trouble processing your response. Could you please rephrase?";
      }

    case "queued":
    case "in_review":
      return "Your case is currently in the queue. A doctor is reviewing it and will respond to you shortly.";

    default:
      return "Your case has been resolved or requires an in-person visit. If you have new symptoms, please start a new conversation.";
  }

  return "I'm sorry, I didn't understand that.";
}

export async function simulatePatient(
  req: Request,
  res: Response,
): Promise<void> {
  const { patientPhone, message } = req.body;

  if (!patientPhone || !message) {
    res
      .status(400)
      .json({
        error: "bad_request",
        message: "patientPhone and message are required",
      });
    return;
  }

  const replyMessage = await processInboundMessage(
    patientPhone,
    message,
    "simulated-" + Date.now(),
  );

  res.status(200).json({
    reply: replyMessage,
  });
}
