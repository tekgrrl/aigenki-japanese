## Grammar Classification System
Every grammar item is classified along three independent axes: how it's produced, what kind of grammatical machinery it is, and what it's used to express. These axes serve different purposes — production type drives pedagogy, structural category drives question generation mechanics, and expressive function drives curriculum organization.
### Axis 1: Production Type
Grammar items are either compositional or constructional.
A compositional item is one the learner produces by applying rules to parts they understand. Conjugating a verb to its て-form, choosing between が and を, combining a relative clause with a noun — these are constructed from understood components. The learner's mental model is "I know the parts, I know the rule, I assemble the result."
A constructional item is one the learner retrieves as a unit, slotting in variables. 〜なければならない is technically decomposable but no learner reconstructs it from parts; they pattern-match the whole shape and fill in the verb. 〜の中で 一番 + adjective is the same — superficially compositional but learned and used as a chunk.
The distinction is a continuum, not a clean binary. Some items have aspects of both (〜たい conjugates compositionally as an i-adjective but is retrieved as a desiderative construction). When in doubt, classify by how the item is primarily taught and accessed, not by its etymological transparency.
### Axis 2: Structural Category
Twelve categories, split between the two production types.
#### Under compositional:

- **Inflectional** — modifies a single word's form. Verb conjugations, adjective conjugations, copula forms.
- **Particle** — single-morpheme function words marking syntactic or pragmatic relationships. Case markers, topic markers, sentence-final particles.
- **Syntactic** — combines clauses or phrases into larger structures. Relative clauses, embedded questions, productive quotation frames.
- **Derivational** — productive word-formation patterns. Honorific prefixes お〜/ご〜, suffixes like 〜的/〜化, compound verb formation.
- **Numerical** — counters and numerical expressions. The combination logic of number + counter, classifier selection.

#### Under constructional:

- **Modal** — expresses speaker stance, attitude, or judgment. Obligation, permission, possibility, intention, desire, hearsay.
- **Aspectual** — expresses event phases or types beyond simple tense. Progressive, resultative, completion, experience, just-completed.
- **Discourse** — manages inter-clause logical relations. Reasoning, concession, sequencing, explanatory frames.
- **Comparative** — expresses comparison, degree, or scope. Superlatives, comparatives, approximation, limitation.
- **Speech-act** — performs a conventional communicative action. Requests, suggestions, offers, benefactive frames.
- **Honorific** — register marking through respectful, humble, and polite forms. Cuts across other categories functionally.
- **Pragmatic** — interactional glue without truth-conditional content. Most sentence-final particles fall here.

The structural category determines what kind of question the system can generate. Inflectional items support conjugation drills. Particles support cloze with same-class distractors. Constructional items support context-driven cloze where the right construction fits the situation. The category is a hint to the question generator about what mechanics are available.

### Axis 3: Expressive Function
Twenty-five functions grouped into five domains. The function is what the grammar lets the learner do communicatively, independent of how it's structurally built.
The five domains:

Describing the world — talking about things, events, states, quantities, comparisons.
Expressing the mind — conveying desires, opinions, certainty levels, feelings, experiences.
Acting in the world — making requests, granting permission, expressing obligation, offering, performing social rituals.
Connecting ideas — reasoning, conditioning, conceding, sequencing, reporting.
Managing conversation — asking questions, managing topics, softening or emphasizing, marking politeness or closeness.

A grammar item can serve multiple expressive functions. 〜のだ serves explanation, emphasis, and softening depending on context. 〜ている serves state-description and habitual-action. The classification stores expressive functions as an ordered array; the first entry is the primary function used for default lesson grouping, with secondary functions available for cross-referencing.
Some grammar items don't map cleanly to any expressive function — sentence-final particles being the clearest case. ね isn't really for anything goal-directed; it's interactional. These items are classified by their nearest expressive function (showing-closeness or softening-emphasizing for ね) and the imperfect fit is accepted rather than worked around with special cases.

### Relationships between the axes
The three axes are independent in principle but show patterns in practice. Modal constructions cluster around expressing-the-mind and acting-in-the-world domains. Discourse constructions cluster around connecting-ideas. Inflectional grammar spreads thinly across all domains because it's foundational machinery rather than purpose-built tooling.
Expressive functions cut across structural categories: making-requests is realized through speech-act constructions (〜てください), inflectional changes (〜てくれない as casual), and honorific patterns (〜ていただけませんか) at different politeness levels. The same expressive function can be served by structurally different grammar.
Confusable items typically share an expressive function while differing structurally or by register. 〜なければならない and 〜なくてはいけない share the obligation function and structural category — they're confusable because they're near-synonyms. 〜から and 〜ので share the reasoning-explanation function but differ in formality and subjectivity — they're confusable for nuance reasons. The pattern is: same expressive function + similar enough structure = high confusability.

### JLPT level interaction
Level isn't part of the classification axes. It's a property of the individual grammar item, not its category. The same expressive function exists across levels with different realizations: making-requests is 〜てください at N5, 〜ていただけませんか at N4, 〜ていただけないでしょうか at N3, and full keigo at N2. The function is the same; the appropriate realization shifts.
One nuance: the same surface form can be classified differently at different levels because the pedagogical treatment differs. 〜なければならない is constructional at N5 (taught as a unit) and effectively compositional at N3+ (decomposable once the learner understands negative conditionals). The cleanest way to handle this is separate grammar entries when the treatment genuinely differs, rather than making the type system level-aware.

### What this classification is for
The structural category is internal scaffolding that tells the system what kind of grammar machine each item is, primarily so that question generation, conjugation handling, and confusability detection can behave correctly. The expressive function is the user-facing organizing principle — it's how grammar is grouped for learners and how the curriculum is structured. The production type is a meta-classification that signals which pedagogical approach fits — rule-and-application or pattern-and-retrieval.
A coding agent working with this classification should expect every grammar entry to carry all three pieces, treat the expressive function array as ordered (primary first), and assume the classification is hand-authored rather than derived. The classification isn't generated from the grammar; it's a curatorial judgment applied to it.