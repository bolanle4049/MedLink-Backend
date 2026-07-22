export interface RedFlagRule {
  keywords: string[];
  name: string;
}

export const redFlagRules: RedFlagRule[] = [
  {
    keywords: ['chest pain', 'sweating', 'left arm pain', 'heart attack'],
    name: 'Chest pain with cardiac warning signs'
  },
  {
    keywords: ['difficulty breathing', 'cannot breathe', "can't breathe", 'gasping', 'suffocating'],
    name: 'Severe respiratory distress'
  },
  {
    keywords: ['heavy bleeding', 'bleeding profusely', 'gushing blood', 'uncontrolled bleeding'],
    name: 'Uncontrolled acute hemorrhage'
  },
  {
    keywords: ['convulsion', 'seizure', 'unresponsive', 'fainted', 'unconscious'],
    name: 'Neurological emergency or unresponsiveness'
  },
  {
    keywords: ['infant fever', 'newborn fever', 'baby hot fever'],
    name: 'High fever in infant under two months'
  },
  {
    keywords: ['stroke', 'slurred speech', 'face drooping', 'numbness one side'],
    name: 'Acute stroke signs'
  }
];

export function checkRedFlags(message: string): { isRedFlag: boolean; ruleName: string } {
  const lowerMsg = message.toLowerCase();
  for (const rule of redFlagRules) {
    for (const kw of rule.keywords) {
      if (lowerMsg.includes(kw)) {
        return { isRedFlag: true, ruleName: rule.name };
      }
    }
  }
  return { isRedFlag: false, ruleName: '' };
}
