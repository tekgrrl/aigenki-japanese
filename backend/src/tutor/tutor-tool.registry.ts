import { AiToolDefinition } from './providers/ai-provider.interface';

export const TOOL_REGISTRY: AiToolDefinition[] = [
  {
    name: 'get_user_profile',
    description:
      "Get the user's JLPT level, communication style, and preferred roleplay role. Call this first to establish the user's profile before fetching other data.",
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_frontier_vocab',
    description:
      "Get vocabulary the user has recently graduated to 'reviewing' status. These are good candidates to weave naturally into scenarios for reinforcement.",
    parameters: {
      type: 'object',
      properties: {
        facetTypes: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional: filter by facet types (e.g. ["Definition-to-Content"]). Omit to return all.',
        },
      },
    },
  },
  {
    name: 'get_leech_vocab',
    description:
      'Get vocabulary the user repeatedly fails. Weave these into contexts that provide repair opportunities.',
    parameters: {
      type: 'object',
      properties: {
        facetTypes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: filter by facet types.',
        },
      },
    },
  },
  {
    name: 'get_allowed_grammar',
    description:
      'Get grammar patterns the user has been exposed to. Constrain generated content to these patterns unless the task explicitly requires otherwise.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_weak_grammar',
    description:
      'Get grammar patterns the user struggles with. Include these in generated content to create repair opportunities.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_curriculum_node',
    description:
      "Get the user's current position in the learning curriculum (e.g. 'N5.basics', 'N4').",
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_knowledge_unit',
    description:
      'Get full data for a specific Knowledge Unit by ID, including any existing lesson content.',
    parameters: {
      type: 'object',
      properties: {
        kuId: {
          type: 'string',
          description: 'The ID of the Knowledge Unit to fetch.',
        },
      },
      required: ['kuId'],
    },
  },
  {
    name: 'search_knowledge_units',
    description:
      "Search global Knowledge Units by type and/or JLPT level. Useful for finding grammar or vocabulary KUs appropriate for the user's level.",
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['Vocab', 'Kanji', 'Grammar', 'Concept', 'ExampleSentence'],
          description: 'Filter by KU type.',
        },
        jlptLevel: {
          type: 'string',
          enum: ['N5', 'N4', 'N3', 'N2', 'N1'],
          description: 'Filter by JLPT level.',
        },
        theme: {
          type: 'string',
          description:
            'Optional keyword to filter KUs by content (substring match).',
        },
      },
    },
  },
  {
    name: 'get_level_seed',
    description:
      'Get a curated baseline of grammar patterns and core vocabulary for a JLPT level. Call this when get_frontier_vocab or get_allowed_grammar return empty results — it is the guaranteed non-empty fallback. Do not invent grammar or vocab outside this baseline.',
    parameters: {
      type: 'object',
      properties: {
        jlptLevel: {
          type: 'string',
          enum: ['N5', 'N4', 'N3', 'N2', 'N1'],
          description: "The user's JLPT level from get_user_profile.",
        },
      },
      required: ['jlptLevel'],
    },
  },
  {
    name: 'create_scenario',
    description:
      'Validate and save a completed scenario. Call this once you have gathered sufficient context and assembled all scenario fields. The backend validates the schema before saving.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short descriptive title in English (e.g. "At the Convenience Store").',
        },
        description: {
          type: 'string',
          description: 'One-sentence description of the scenario and its goal. Write in English.',
        },
        difficultyLevel: {
          type: 'string',
          enum: ['N5', 'N4', 'N3', 'N2', 'N1'],
          description: "JLPT difficulty level matching the user's level.",
        },
        setting: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'Physical location in English (e.g. "convenience store", "train station").',
            },
            participants: {
              type: 'array',
              items: { type: 'string' },
              description: 'Names or roles of all participants.',
            },
            goal: {
              type: 'string',
              description: "The user's objective to accomplish in this scenario. Write in English.",
            },
            timeOfDay: {
              type: 'string',
              description: 'Time context in English (e.g. "morning", "late evening").',
            },
            visualPrompt: {
              type: 'string',
              description: 'Short description for scene illustration. Write in English.',
            },
          },
          required: ['location', 'participants', 'goal', 'timeOfDay', 'visualPrompt'],
        },
        roles: {
          type: 'object',
          properties: {
            user: { type: 'string', description: "The user's character/role name." },
            ai: {
              type: 'string',
              description: "The AI's character/role name (or comma-separated names for multi-role).",
            },
          },
          required: ['user', 'ai'],
        },
        dialogue: {
          type: 'array',
          description: 'Model dialogue illustrating how the scenario plays out.',
          items: {
            type: 'object',
            properties: {
              speaker: { type: 'string' },
              text: { type: 'string', description: 'Japanese dialogue text.' },
              translation: { type: 'string', description: 'English translation.' },
            },
            required: ['speaker', 'text', 'translation'],
          },
        },
        extractedKUs: {
          type: 'array',
          description: 'Key vocabulary words from the dialogue.',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'The Japanese word.' },
              reading: { type: 'string', description: 'Hiragana/katakana reading.' },
              meaning: { type: 'string', description: 'English meaning.' },
              type: { type: 'string', enum: ['vocab', 'kanji'] },
              jlptLevel: { type: 'string', description: 'JLPT level if known.' },
            },
            required: ['content', 'reading', 'meaning', 'type'],
          },
        },
        grammarNotes: {
          type: 'array',
          description: 'Grammar patterns featured in the scenario.',
          items: {
            type: 'object',
            properties: {
              pattern: {
                type: 'string',
                description: 'The grammar pattern template (e.g. "～をお願いします").',
              },
              title: { type: 'string' },
              explanation: { type: 'string' },
              exampleInContext: {
                type: 'object',
                properties: {
                  japanese: { type: 'string' },
                  english: { type: 'string' },
                  fragments: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Sentence fragments for drill exercises.',
                  },
                  accepted_alternatives: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Alternative acceptable responses.',
                  },
                },
                required: ['japanese', 'english', 'fragments', 'accepted_alternatives'],
              },
            },
            required: ['title', 'explanation', 'exampleInContext'],
          },
        },
      },
      required: [
        'title',
        'description',
        'difficultyLevel',
        'setting',
        'roles',
        'dialogue',
        'extractedKUs',
        'grammarNotes',
      ],
    },
  },
];
