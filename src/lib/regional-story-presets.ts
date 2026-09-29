import { DEFAULT_PROJECT_GENRE, type ProjectGenreLabel } from './project-genres'

// Editorial recipes for the user's reference categories, not audience rankings.
// Market reports inform pacing/localization; the Shahid examples are long-form
// narrative references, not evidence that a genre dominates short drama.
// Sources (editorial provenance, not runtime configuration):
// https://www.businessofapps.com/insights/the-2025-short-drama-report/
// https://www.futuremediahubs.com/news/european-public-broadcasters-explore-rise-microdrama
// https://www.1stopasia.com/blog/short-drama-localization-in-next-18-months/
// https://www.voguearabia.com/article/new-tv-shows-and-movies-on-shahid-autumn

export const REGIONAL_STORY_GROUPS = [
    {
        key: 'north-america',
        label: '北美',
        hint: '都市复仇、硬核悬疑、暗黑奇幻、惊悚反转、职场逆袭',
        name: 'North America',
        context:
            'Choose a specific North American country and city. Ground work, legal procedure, class and family relationships in that setting; the US, Canada and Mexico are not interchangeable. Use an immediate personal stake, active confrontation and earned reversals. Fantasy may use supernatural contracts or rival factions only when chosen by the story.'
    },
    {
        key: 'southeast-asia',
        label: '东南亚',
        hint: '豪门恩怨、甜宠逆袭、家庭伦理、重生复仇',
        name: 'Southeast Asia',
        context:
            'Choose one specific country and community, such as Thailand, Indonesia, the Philippines, Vietnam, Malaysia or Singapore. Localize forms of address, family obligations, class, housing and daily routines to that place. Family and romance stakes can fuel fast emotional reversals, but individual agency matters. Never mix national dress, faiths or customs into a pan-regional collage.'
    },
    {
        key: 'europe',
        label: '欧洲',
        hint: '大女主逆袭、豪门家族纷争、都市情感、传奇励志、女性成长',
        name: 'Europe',
        context:
            'Choose a specific European country, city and social milieu. Make dialogue, work, housing and institutions locally plausible. Use clear hooks and consequential choices; social pressure, relationships and identity can drive conflict. Preserve protagonist agency and complex opponents. Do not equate Europe with aristocracy or uniformly slow pacing.'
    },
    {
        key: 'middle-east',
        label: '中东',
        hint: '犯罪悬疑、暗黑奇幻、都市反转、历史传奇、人性剧情',
        name: 'Middle East',
        context:
            'Choose a specific country, city, community and era; Gulf, Levantine and other Middle Eastern settings are not interchangeable. Family ties, economic pressure, ambition and moral consequences can motivate conflict. Verify setting-specific legal and social details; do not invent universal inheritance, marriage or policing rules. Portray varied occupations and individual agency, not a region reduced to deserts, wealth, oppression or violence.'
    }
] as const

type RegionKey = (typeof REGIONAL_STORY_GROUPS)[number]['key']

export interface RegionalStoryPreset {
    key: string
    region: RegionKey
    label: string
    hint: string
    genre: ProjectGenreLabel
    family: 'modern' | 'historical-fantasy'
    story: string
    visual: string
    /** Cover-only scene: never insert these actors or places into production. */
    previewScene: string
}

export const REGIONAL_STORY_PRESETS: RegionalStoryPreset[] = [
    {
        key: 'na-urban-revenge',
        region: 'north-america',
        label: '都市复仇',
        hint: '背叛开局、证据反击、身份翻盘',
        genre: '都市',
        family: 'modern',
        story: 'Open with a concrete betrayal that threatens livelihood or reputation. Give the protagonist an evidence-led plan, capable allies and a credible opponent. Escalate exposure, counterattack and public reckoning through causal choices; show the personal cost of revenge. A hidden identity is a planted payoff, never a substitute for effort.',
        visual: 'North American urban revenge drama, live-action cinematic realism, contrasting corporate interiors and everyday apartments, tailored workwear appropriate to the cast, cool steel tones with a controlled warm accent, confrontational eyelines and decisive evidence close-ups',
        previewScene:
            'Present-day Chicago: an adult Black woman investigator in a charcoal suit holds a sealed evidence envelope at the threshold of a glass boardroom; an unsettled executive is visible deeper inside, blue-hour skyline, controlled amber desk light.'
    },
    {
        key: 'na-hardboiled-mystery',
        region: 'north-america',
        label: '硬核悬疑',
        hint: '证据链、时间线、逻辑破局',
        genre: '悬疑 / 推理',
        family: 'modern',
        story: 'Build a solvable mystery with a fixed truth, timeline, motives and evidence chain before revealing clues. Every reversal must reinterpret a planted observation. Give investigators plausible jurisdiction and limits; suspects have independent goals. End episodes on an actionable clue or contradiction, not an arbitrary confession.',
        visual: 'North American investigative suspense, grounded live-action noir, practical task lighting, restrained cold neutral palette, tactile evidence and believable workspaces, readable geography and selective clue close-ups',
        previewScene:
            'Present-day Toronto: an adult East Asian Canadian detective studies a damaged wristwatch in an evidence sleeve at a quiet workbench; a partner appears behind a glass partition, single warm task lamp against cool night windows, no readable writing.'
    },
    {
        key: 'na-dark-fantasy',
        region: 'north-america',
        label: '暗黑奇幻',
        hint: '超自然契约、阵营冲突、代价抉择',
        genre: '奇幻',
        family: 'historical-fantasy',
        story: 'Define one coherent supernatural system with explicit powers, limits and costs. Rival factions, forbidden bonds or a dangerous pact create personal stakes. Plant the price of each power before it resolves a conflict. Establish the chosen era and whether the hidden world coexists with ordinary society; do not force every story into vampire or werewolf romance.',
        visual: 'North American dark fantasy cinema, live-action gothic atmosphere, sculpted moonlight and warm practical light, tangible supernatural effects governed by the story, consistent faction design and era-specific wardrobe',
        previewScene:
            'A fictional adult woman in a dark tailored coat faces a fractured obsidian mirror in an abandoned New England manor; a subtle supernatural silhouette appears only in the mirror, moonlit window and one amber lamp, no symbols or writing.'
    },
    {
        key: 'na-thriller-twist',
        region: 'north-america',
        label: '惊悚反转',
        hint: '熟悉空间、危机升级、伏笔反转',
        genre: '惊悚',
        family: 'modern',
        story: 'Turn a familiar home, road or workplace into a credible threat. Restrict viewpoint without lying about visible facts. Escalate through choices, time pressure and spatially clear obstacles. Seed each reveal and retain the consequences after a twist; build suspense through performance and sound rather than gratuitous gore.',
        visual: 'North American psychological thriller, live-action practical lighting, familiar domestic spaces made tense through occlusion and negative space, precise spatial continuity, restrained colors and sharp reaction close-ups',
        previewScene:
            'Present-day suburban Pacific Northwest: an adult woman freezes beside her kitchen door with a phone held low; the glass reflection reveals a second figure outside that she has not seen, warm kitchen against cold rain, tense restrained composition.'
    },
    {
        key: 'na-workplace-comeback',
        region: 'north-america',
        label: '职场逆袭',
        hint: '能力证明、职场博弈、赢回话语权',
        genre: '剧情',
        family: 'modern',
        story: "Start with a stolen idea, unfair dismissal or credible professional setback. Establish the protagonist's demonstrable skill and workplace power structure. Wins require preparation, collaboration and strategic evidence. Make promotion, accountability or independence earned; avoid a last-minute rich rescuer or implausible instant CEO appointment.",
        visual: 'North American workplace comeback drama, live-action bright but dimensional office cinematography, realistic professional wardrobes, visual contrast between cramped workstations and executive spaces, confident framing earned by the story',
        previewScene:
            'Present-day Seattle: an adult South Asian woman engineer places a working prototype on a boardroom table while senior colleagues lean forward; morning skyline through glass, navy and warm copper palette, determined composed expression.'
    },
    {
        key: 'sea-dynasty-feud',
        region: 'southeast-asia',
        label: '豪门恩怨',
        hint: '家业继承、亲情利益、秘密揭露',
        genre: '豪门',
        family: 'modern',
        story: 'Map the family tree, business ownership and competing loyalties before plotting inheritance or succession. Use a meal, engagement or company decision as a pressure point. Revelations must alter relationships and material stakes. Give each generation a defensible motive and localize customs to one country rather than recycling a generic palace feud.',
        visual: 'Southeast Asian family-business melodrama, live-action rich interior depth, locally appropriate formal clothing, contrast between affluent homes and working spaces, humid exterior light and controlled jewel-tone accents',
        previewScene:
            'Present-day Bangkok: an adult Thai daughter stands at the end of a teak dining table holding a closed company folder while her older mother and brother exchange guarded looks; contemporary affluent home opening onto a tropical garden, emerald and amber accents.'
    },
    {
        key: 'sea-sweet-romance',
        region: 'southeast-asia',
        label: '甜宠逆袭',
        hint: '双向支持、阶层阻力、甜蜜成长',
        genre: '爱情',
        family: 'modern',
        story: "Build attraction through specific acts of care, consent and reciprocal support. Give the less privileged lead an independent skill and ambition. Class or family pressure creates obstacles that the couple actively negotiates; alternate earned warmth with setbacks. Romance supports a comeback without replacing the protagonist's own achievement.",
        visual: 'Southeast Asian romantic comeback drama, live-action soft directional daylight, contemporary casual wardrobe suited to local weather, lively neighborhood businesses and intimate two-shots, warm restrained pastel accents',
        previewScene:
            'Present-day Manila: an adult Filipina baker in a flour-dusted apron laughs as her adult partner helps carry a tray into her newly opened neighborhood bakery; warm morning window light and soft coral accents, equal affectionate body language.'
    },
    {
        key: 'sea-family-ethics',
        region: 'southeast-asia',
        label: '家庭伦理',
        hint: '代际分歧、照护责任、情感和解',
        genre: '家庭',
        family: 'modern',
        story: 'Center a concrete conflict over caregiving, debt, housing or independence. Distinguish affection from obligation and give different generations credible needs. Reveal secrets through consequential choices in everyday routines. Reconciliation requires accountability and changed behavior; abuse is not justified by filial duty.',
        visual: 'Southeast Asian intimate family drama, live-action inhabited homes with country-specific furnishings, climate-appropriate everyday clothes, warm practical lighting and honest skin texture, eye-level ensemble blocking',
        previewScene:
            'Present-day Yogyakarta: an adult Indonesian daughter and her elderly father sit across a modest family dining table, an unopened travel bag beside her chair; rain beyond an open veranda, warm pendant light, tender unresolved expressions.'
    },
    {
        key: 'sea-rebirth-revenge',
        region: 'southeast-asia',
        label: '重生复仇',
        hint: '二次人生、时间规则、步步反击',
        genre: '奇幻',
        family: 'historical-fantasy',
        story: 'Define the reset point, retained memories, limits of foreknowledge and consequences of changing events. Repeat an early situation with one deliberate new choice so viewers understand the second chance. Revenge unfolds through verifiable evidence and changed alliances; future knowledge must become less reliable as the timeline diverges.',
        visual: 'Southeast Asian second-chance revenge drama, live-action grounded locations in a clearly established timeline, a restrained repeated prop or color motif for memory transitions, consistent wardrobe per timeline, no arbitrary fantasy costume',
        previewScene:
            'Present-day Ho Chi Minh City: an adult Vietnamese woman in a cream blouse calmly closes a jade-green pocket watch before entering a tense family celebration; rainlit courtyard beyond, a subtle repeated reflection hints at a second chance, single coherent scene.'
    },
    {
        key: 'eu-heroine-comeback',
        region: 'europe',
        label: '大女主逆袭',
        hint: '自主抉择、专业破局、重掌人生',
        genre: '剧情',
        family: 'modern',
        story: 'Give the heroine a precise goal, professional competence and flaws beyond her relationship status. A betrayal or structural obstacle prompts a costly decision. Build reversals through initiative, alliances and skill, not only a new romantic partner. Her final definition of success follows her values and visibly changes her circumstances.',
        visual: 'European heroine-led comeback drama, live-action location-specific workplaces, tactile contemporary wardrobe, clear character-first compositions and motivated daylight, increasing visual agency through blocking',
        previewScene:
            'Present-day Lyon: an adult French woman chef confidently opens the doors of her small restaurant, a trusted colleague beside her and a former business partner outside; early light on limestone frontage, grounded professional energy.'
    },
    {
        key: 'eu-family-dynasty',
        region: 'europe',
        label: '豪门家族纷争',
        hint: '家族产业、继承争议、旧事新账',
        genre: '豪门',
        family: 'modern',
        story: "Anchor the dynasty in a specific industry and local ownership structure. Inheritance, succession and legacy collide with individual loyalties and workers' interests. Plant documents and family secrets before their payoff. Contemporary wealth need not imply nobility; period settings require their own laws, chronology and social hierarchy.",
        visual: 'European family dynasty drama, live-action contrast of inherited property and active enterprise, region-specific architecture and textiles, restrained deep green and burgundy accents, ensemble power geometry',
        previewScene:
            'Present-day Tuscany: three adult Italian siblings face each other across a winery tasting table, a sealed estate folder between them; working vineyards beyond tall windows, weathered stone and contemporary formalwear, tense diagonal blocking.'
    },
    {
        key: 'eu-urban-relationships',
        region: 'europe',
        label: '都市情感',
        hint: '亲密关系、现实压力、情感选择',
        genre: '爱情',
        family: 'modern',
        story: 'Ground attraction and conflict in work, housing, friendship or care responsibilities. Let characters speak naturally with subtext and distinct voices, while each short episode still changes the relationship. Avoid endless misunderstandings that one honest sentence would solve. Choices about intimacy, trust and independence have consequences.',
        visual: 'European urban relationship drama, live-action specific lived-in city neighborhoods, public transit and apartments appropriate to the setting, available-light intimacy, eye-level two-shots and subtle emotional close-ups',
        previewScene:
            'Present-day Berlin: an adult interracial couple pauses at a tram shelter after rain, one offering a small apartment key while the other considers it; warm street reflections and cool twilight, restrained intimate framing, no legible signage.'
    },
    {
        key: 'eu-inspirational-journey',
        region: 'europe',
        label: '传奇励志',
        hint: '长期目标、挫折积累、突破自我',
        genre: '剧情',
        family: 'modern',
        story: 'Follow an ambitious craft, sport or civic goal through measurable milestones, setbacks and sacrifices. Support achievement with training, resources and relationships rather than destiny. Use time jumps with explicit continuity and earned turning points. For a historical or biographical brief, respect chronology and distinguish fiction from verified facts.',
        visual: 'European inspirational life drama, live-action tactile workplaces and training environments, location- and era-appropriate materials, progression through repeated compositions and changing practical light, grounded physical effort',
        previewScene:
            'Present-day Porto: an adult Portuguese woman boatbuilder lifts a restored wooden hull into place with her small workshop team; morning sun through high windows catches wood shavings, worn practical clothing, visibly earned pride.'
    },
    {
        key: 'eu-womens-growth',
        region: 'europe',
        label: '女性成长',
        hint: '自我认同、关系边界、互助成长',
        genre: '剧情',
        family: 'modern',
        story: 'Center self-definition, boundaries and changing relationships across a clearly chosen life stage. Give women different priorities and meaningful solidarity without making them interchangeable. Progress is visible in actions, material choices and setbacks; romance is optional. Use an external goal to make internal growth dramatically legible.',
        visual: 'European women-centered personal growth drama, live-action everyday environments and varied individual styling, natural skin texture, warm neutral colors, attentive close-ups and balanced ensemble framing',
        previewScene:
            'Present-day Copenhagen: an adult woman in her forties unlocks a small shared design studio as two women friends carry in tools and plants; pale morning light, practical contemporary clothing, quiet anticipation and mutual support.'
    },
    {
        key: 'me-crime-mystery',
        region: 'middle-east',
        label: '犯罪悬疑',
        hint: '案件线索、关系暗网、真相代价',
        genre: '犯罪',
        family: 'modern',
        story: 'Choose a specific city and a plausible crime such as financial fraud, disappearance or blackmail. Link evidence, motives and family or business ties without equating criminality with ethnicity or faith. Local procedure and investigative authority must fit the jurisdiction. Revelations should expose choices and consequences rather than rely on a faceless conspiracy.',
        visual: 'Middle Eastern crime suspense, live-action contemporary city workspaces, locally grounded professional clothing and architecture, layered reflections and restrained low-key light, evidence-led visual storytelling',
        previewScene:
            'Present-day Amman: an adult Jordanian woman forensic accountant examines a broken security token beside a closed ledger in a modern office; a tense colleague waits at the door, layered night reflections, amber desk light, no readable text.'
    },
    {
        key: 'me-dark-fantasy',
        region: 'middle-east',
        label: '暗黑奇幻',
        hint: '禁忌契约、欲望代价、命运博弈',
        genre: '奇幻',
        family: 'historical-fantasy',
        story: 'Create a coherent invented supernatural world with a specific cultural and era reference. A pact, inherited curse or forbidden wish has explicit rules and a moral price. Do not treat living religious practice as a magical threat or combine unrelated traditions. Give protagonists agency against fate and resolve twists through established rules.',
        visual: 'Middle Eastern dark fantasy cinema, live-action material realism, a coherent invented world grounded in one chosen architectural tradition, sculpted shadows and copper light, tactile supernatural phenomena and era-consistent costume',
        previewScene:
            'An invented Levantine-inspired fantasy city: an adult archivist in a dark woven coat faces a suspended cracked bronze vessel in a stone courtyard; a faint shadow takes an impossible shape, copper lamplight and deep blue night, no sacred imagery or writing.'
    },
    {
        key: 'me-urban-reversal',
        region: 'middle-east',
        label: '都市反转',
        hint: '都市秘密、利益冲突、因果翻盘',
        genre: '都市',
        family: 'modern',
        story: 'Place a personal secret inside a specific contemporary workplace, household or business. Let ambition, debt, trust and family loyalty create competing choices. Each twist must reveal a planted fact and change the balance of power. Use varied ordinary livelihoods; avoid turning every city story into a billionaire fantasy.',
        visual: 'Middle Eastern urban reversal drama, live-action contemporary apartments and workplaces, locally specific street life and clothing, clean spatial staging and contrasting interior light, readable emotional reactions',
        previewScene:
            'Present-day Riyadh: an adult Saudi woman entrepreneur pauses in her contemporary office as a colleague returns a missing company access card; a guarded associate watches through glass, realistic local business dress, warm evening city light.'
    },
    {
        key: 'me-historical-legend',
        region: 'middle-east',
        label: '历史传奇',
        hint: '时代考据、个人命运、历史洪流',
        genre: '历史 / 年代',
        family: 'historical-fantasy',
        story: 'Fix a specific place, century and historical context before plotting. Interweave a fictional personal goal with trade, scholarship, political change or community survival. Keep technology, dress, travel, language and institutions consistent with that era. Distinguish attested history from invented characters; no random mix of Arab, Persian, Ottoman and ancient motifs.',
        visual: 'Middle Eastern historical epic, live-action period craftsmanship and tactile materials, researched architecture and wardrobe for one defined place and century, credible practical illumination, clear geography and human-scale drama',
        previewScene:
            'Abbasid Baghdad in the ninth century: a fictional adult woman bookbinder carries a wrapped manuscript through a brick courtyard workshop; linen layers and period-bound tools, warm low sun, traders in the background, no modern objects or readable writing.'
    },
    {
        key: 'me-human-drama',
        region: 'middle-east',
        label: '人性剧情',
        hint: '道德困境、亲情责任、选择后果',
        genre: '剧情',
        family: 'modern',
        story: 'Build a dilemma with two understandable but incompatible obligations: honesty and livelihood, care and autonomy, loyalty and justice. Give each affected person a voice and material stakes. Family bonds may support or constrain choices, but never erase individual agency. Resolve through a costly action and its aftermath rather than a moralizing speech.',
        visual: 'Middle Eastern intimate human drama, live-action lived-in homes and ordinary workplaces, locally appropriate everyday clothing, honest tactile surfaces and warm practical light, patient eye-level performance coverage',
        previewScene:
            'Present-day Beirut: an adult Lebanese bus mechanic and her elderly father sit beside an open workshop doorway after closing, a repaired family radio between them; warm work light against blue evening, conflicted tenderness, worn everyday clothes.'
    }
]

const LOCALIZATION_RULES =
    "Treat this preset as a creative starting point, not a claim about every audience in a region. The user's explicit setting, era, character identities and existing story bible take precedence over defaults. Before drafting, establish one concrete country/city or a coherent invented world, period, social milieu and naming convention in the story bible; keep them consistent. Preserve the selected content language; a region must not automatically change dialogue language. Localize idioms, honorifics, occupations, homes, costume and relationships to the chosen community without stereotyping ethnicity, religion or gender. Use clear opening stakes, a causal turn and an earned hook at the requested episode length. Do not insert the preview cover's actors or location into the story. During adaptation, preserve supplied plot and dialogue; apply these guidelines only where consistent with the source."

export function getRegionalStoryPreset(key: string | null | undefined): RegionalStoryPreset | undefined {
    return REGIONAL_STORY_PRESETS.find(preset => preset.key === key)
}

/** Suggest a matching broad genre while retaining an independently chosen one. */
export function selectRegionalStoryStyle<T extends { visualStyle: string; genre: string }>(form: T, visualStyle: string): T {
    const previous = getRegionalStoryPreset(form.visualStyle)
    const next = getRegionalStoryPreset(visualStyle)
    const suggestGenre = form.genre === DEFAULT_PROJECT_GENRE || (previous && form.genre === previous.genre)
    return { ...form, visualStyle, genre: next && suggestGenre ? next.genre : form.genre }
}

export function formatRegionalStoryContext(key: string | null | undefined): string {
    const preset = getRegionalStoryPreset(key)
    if (!preset) return ''
    const region = REGIONAL_STORY_GROUPS.find(group => group.key === preset.region)!
    return [
        `Regional story direction: ${region.name} / ${preset.key}`,
        LOCALIZATION_RULES,
        `Local context: ${region.context}`,
        `Narrative recipe: ${preset.story}`,
        `Visual direction: ${preset.visual}`
    ].join('\n')
}

export function regionalVisualDirection(preset: RegionalStoryPreset): string {
    return `${preset.visual}. Follow the established story's specific country, community, era, identities and locations; explicit user settings take precedence over regional defaults. Maintain local costume, architecture, props and lighting continuity; avoid mixing cultures or copying preview-cover characters.`
}

export function buildRegionalPreviewPrompt(preset: RegionalStoryPreset): string {
    return `${preset.visual}. Cover scene: ${preset.previewScene} Premium 9:16 vertical short-drama cover, one coherent cinematic scene, clear focal hierarchy and expressive adult fictional cast, natural anatomy and skin texture, legible at thumbnail size. No text, title, logos, watermark or UI.`
}
