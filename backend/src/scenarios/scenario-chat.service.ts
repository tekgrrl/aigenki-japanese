import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Scenario, ExtractedKU, ChatMessage, ScenarioEvaluation, GrammarMatch } from '../types/scenario';
import { GeminiService } from '../gemini/gemini.service';
import { UserService, excludedContentOf } from '../users/user.service';
import { buildChatSystemPrompt, buildLiveExtractionPrompt } from '../prompts/scenario.prompts';
import { GET_GRAMMAR_PATTERNS_DECLARATION } from '../prompts/curriculum';
import { ScenarioKnowledgeService } from './scenario-knowledge.service';
import { scenarioRoles } from './scenario-roles';

/**
 * The Role Play conversation: the AI's replies, the opening line, the evaluation at the end and the
 * words and grammar mined from what the learner said. It doesn't read or write the scenario doc;
 * ScenariosService loads the scenario and saves what these methods return.
 */
@Injectable()
export class ScenarioChatService {
  private readonly logger = new Logger(ScenarioChatService.name);

  constructor(
    private readonly geminiService: GeminiService,
    private readonly userService: UserService,
    private readonly scenarioKnowledge: ScenarioKnowledgeService,
  ) {}

  /** The learner's message and the AI's reply to it, ready to append to the chat history. */
  async reply(uid: string, scenario: Scenario, userMessage: string): Promise<{ userMsg: ChatMessage; aiMsg: ChatMessage }> {
    const userMsg: ChatMessage = {
      speaker: 'user',
      text: userMessage,
      timestamp: Date.now(),
    };

    let historyLines = "No previous conversation.";
    if (scenario.chatHistory && scenario.chatHistory.length > 0) {
      historyLines = scenario.chatHistory.map(msg => {
        const role = msg.speaker === 'user' ? 'User' : 'AI';
        return `${role}: ${msg.text}`;
      }).join('\n');
    }

    let referenceScript = "No reference script available.";
    if (scenario.dialogue && scenario.dialogue.length > 0) {
      referenceScript = scenario.dialogue.map(line => {
        return `${line.speaker}: ${line.text} (${line.translation || ''})`;
      }).join('\n');
    }

    const { userRole, aiRole } = scenarioRoles(scenario);

    const { excludedVocab, excludedGrammar } = excludedContentOf((await this.userService.findById(uid)) ?? undefined);
    const systemPrompt = buildChatSystemPrompt(scenario, aiRole, userRole, referenceScript, historyLines, excludedVocab, excludedGrammar);

    const aiResponse = await this.geminiService.generateChatResponse(
      systemPrompt,
      userMessage,
      { scenarioId: scenario.id, topic: scenario.title }
    );

    if (!aiResponse) {
      throw new InternalServerErrorException("Failed to generate AI response");
    }

    const aiMsg: ChatMessage = {
      speaker: 'ai',
      text: aiResponse.message,
      timestamp: Date.now(),
      correction: aiResponse.correction,
      sceneFinished: aiResponse.sceneFinished,
      roleName: aiResponse.speaker || undefined,
    };

    return { userMsg, aiMsg };
  }

  /** The chat's opening: the first dialogue line if the AI speaks first, otherwise empty. */
  initialChatHistory(scenario: Scenario): ChatMessage[] {
    if (!scenario.dialogue || scenario.dialogue.length === 0) return [];

    const firstLine = scenario.dialogue[0];

    // Primary signal: explicit speakerRole, set directly by the generation
    // prompt — unambiguous regardless of what language/name the model chose
    // for the free-text `speaker` label. Fixes GitHub #213 (fuzzy string
    // matching between `speaker` and `roles.ai`/`roles.user` failed silently
    // whenever the two were in different languages, e.g. "店員" vs "Shop Assistant").
    if (firstLine.speakerRole) {
      if (firstLine.speakerRole === 'user') return [];
      return [{
        speaker: 'ai',
        text: firstLine.text,
        timestamp: Date.now(),
        roleName: firstLine.speaker,
      }];
    }

    // Fallback for scenarios generated before speakerRole existed.
    this.logger.warn(`initialChatHistory: dialogue[0] has no speakerRole (scenario ${scenario.id}, predates #213 fix) — falling back to fuzzy speaker-name matching`);

    const { userRole, aiRole: aiRolesRaw } = scenarioRoles(scenario);

    const aiRoles = Array.isArray(aiRolesRaw) ? aiRolesRaw : [aiRolesRaw];
    const speaker = firstLine.speaker.toLowerCase();
    const user = userRole.toLowerCase();

    if (user.includes(speaker) || speaker.includes(user)) {
      return [];
    }

    const matchedAiRole = aiRoles.find(r => {
      const ai = r.toLowerCase();
      return ai.includes(speaker) || speaker.includes(ai);
    });

    if (matchedAiRole) {
      return [{
        speaker: 'ai',
        text: firstLine.text,
        timestamp: Date.now(),
        roleName: matchedAiRole,
      }];
    }

    return [];
  }

  /** Grades the finished chat. Passed needs the objective met and a rating of 3 or more. */
  async evaluate(scenario: Scenario): Promise<ScenarioEvaluation> {
    const { userRole, aiRole } = scenarioRoles(scenario);

    const aiRoleStr = Array.isArray(aiRole) ? aiRole.join(', ') : aiRole;
    const context = {
      title: scenario.title,
      goal: scenario.setting.goal,
      difficulty: scenario.difficultyLevel,
      isObjectiveMet: scenario.isObjectiveMet ?? false,
      userRole,
      aiRole: aiRoleStr,
      ...(scenario.simulationBrief ? { simulationBrief: scenario.simulationBrief } : {}),
    };

    const history = (scenario.chatHistory || []).map(msg => ({
      speaker: msg.speaker,
      text: msg.text
    }));

    const evaluation = await this.geminiService.evaluateScenario(history, context);

    // IF success AND rating >= 3 -> Passed, ELSE -> Failed
    if (evaluation.success && evaluation.rating >= 3) {
      evaluation.outcome = 'passed';
      evaluation.recommendedAction = 'replay_chat'; // or maybe just 'practice_roleplay'
    } else {
      evaluation.outcome = 'failed';
      evaluation.recommendedAction = 'repeat_lesson';
    }

    return evaluation;
  }

  /**
   * Mines new vocab/grammar from what the user actually said during the live
   * 'simulate' chat (as opposed to the AI-scripted 'encounter' dialogue), and
   * enrolls anything genuinely new via the same linking helpers 'encounter'
   * uses. Deliberately conservative: does not touch SRS/leech state, does not
   * create review facets — stops at the same enrollment depth 'encounter'
   * already stops at (UserKnowledgeUnit + UserGrammarLesson).
   */
  async extractLiveChatKnowledge(
    uid: string,
    scenario: Scenario,
    evaluation: ScenarioEvaluation,
  ): Promise<{ extractedKUs: ExtractedKU[]; grammarMatches: GrammarMatch[] }> {
    const userLines = (scenario.chatHistory || [])
      .filter(msg => msg.speaker === 'user')
      .map(msg => msg.text);

    if (userLines.length === 0) {
      return { extractedKUs: [], grammarMatches: [] };
    }

    const prompt = buildLiveExtractionPrompt(scenario, userLines, evaluation.corrections ?? []);

    const data = await this.geminiService.generateWithTools<{ extractedKUs?: any[]; grammarMatches?: any[] }>(
      prompt,
      '',
      [GET_GRAMMAR_PATTERNS_DECLARATION],
      this.scenarioKnowledge.buildGrammarToolHandlers(uid),
      undefined,
      { route: '/scenarios/extract-live', topic: scenario.title },
    );

    const candidateKUs: ExtractedKU[] = Array.isArray(data.extractedKUs) ? data.extractedKUs : [];
    const candidateMatches: GrammarMatch[] = Array.isArray(data.grammarMatches) ? data.grammarMatches : [];

    // "New to this user" filter — grammar is already scoped to the user's own
    // enrolled pool by get_grammar_patterns, but vocab has no such scoping, so
    // skip anything the user already has a UserKnowledgeUnit for.
    const extractedKUs: ExtractedKU[] = [];
    for (const ku of candidateKUs) {
      const linked = await this.scenarioKnowledge.linkVocabIfNew(uid, scenario, ku);
      if (linked) extractedKUs.push(linked);
    }

    const grammarMatches: GrammarMatch[] = [];
    for (const match of candidateMatches) {
      if (await this.scenarioKnowledge.linkGrammarMatch(uid, scenario, match, 'scenario-live')) {
        grammarMatches.push(match);
      }
    }

    return { extractedKUs, grammarMatches };
  }
}
