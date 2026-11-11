import { Logger } from '@nestjs/common';
import { Scenario } from '../types/scenario';
import { ALLOWED_USER_ROLES, ALLOWED_AI_ROLES } from '../prompts/scenario.prompts';

const logger = new Logger('ScenarioRoles');

/** The learner's role and the AI's role(s): the stored `roles`, or guessed from the participants for older scenarios. */
export function scenarioRoles(scenario: Scenario): { userRole: string; aiRole: string | string[] } {
  if (scenario.roles?.user && scenario.roles?.ai) {
    return { userRole: scenario.roles.user, aiRole: scenario.roles.ai };
  }
  return determineRoles(scenario.setting.participants);
}

/** Guesses which participant is the learner and which the AI, for scenarios saved before `roles` existed. */
export function determineRoles(participants: string[]): { aiRole: string; userRole: string } {
  if (!participants || participants.length === 0) {
    return { aiRole: 'Partner', userRole: 'Traveler' };
  }

  let userRole = participants.find(p => ALLOWED_USER_ROLES.some(k => p.toLowerCase().includes(k.toLowerCase())));
  let aiRole: string;

  if (userRole) {
    // AI is the other participant
    aiRole = participants.find(p => p !== userRole) || 'Partner';
  } else {
    // Try to find AI Role first
    const foundAiRole = participants.find(p => ALLOWED_AI_ROLES.some(k => p.toLowerCase().includes(k.toLowerCase())));

    if (foundAiRole && !userRole) {
      aiRole = foundAiRole;
      userRole = participants.find(p => p !== aiRole) || 'Traveler';
    } else {
      // Fallback: Assume index 1 is user (common in generated scenarios like ["Staff", "Traveler"])
      if (participants.length > 1) {
        userRole = participants[1];
        aiRole = participants[0];
      } else {
        // Only 1 participant?
        userRole = 'Traveler'; // Default
        aiRole = participants[0] || 'Partner';
      }
    }
  }

  logger.log(`AI Role: ${aiRole}, User Role: ${userRole}`);

  return { aiRole, userRole };
}
