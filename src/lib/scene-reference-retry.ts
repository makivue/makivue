export const SCENE_REFERENCE_NEGATIVE = [
    'people',
    'person',
    'human',
    'humanoid',
    'character',
    'crowd',
    'audience',
    'spectator',
    'player',
    'athlete',
    'portrait',
    'face',
    'silhouette',
    'reflection of a person',
    'statue shaped like a person',
    'humanoid robot',
    'humanoid mecha',
    'human-shaped chess piece',
    'occupied seats',
    'collage',
    'contact sheet',
    'split screen',
    'multi-panel layout',
    'inset image',
    'poster layout',
    'letters',
    'words',
    'captions',
    'watermark',
    'gibberish text',
    'warped architecture',
    'impossible geometry'
].join(', ')

export const SCENE_SINGLE_IMAGE_LOCK =
    'ONE single uninterrupted environment image, one coherent physical location, one camera view only, no collage, no panels, no split screen, no inset image. Show the production set before casting and before movable story props are added: every street, platform, seat, stand and interior is visibly vacant. Absolutely zero people, zero characters, zero crowds, zero spectators, zero humanoids, zero human-shaped robots or chess pieces, zero faces and zero human silhouettes anywhere in frame. Omit readable or gibberish text, captions and watermarks.'

/**
 * Remove source wording that makes an image model populate an otherwise empty
 * location reference. Architecture stays intact while actors and human-shaped
 * set dressing are made explicitly non-humanoid.
 */
export function sanitizeSceneReferenceLocationPrompt(prompt: string) {
    return prompt
        .replace(/\b(?:spectator|audience)\s+(?:stands?|seating|tiers?)\b/gi, 'completely vacant seating tiers')
        .replace(/\b(?:bustling|crowded|busy|lively|populated)\b/gi, 'visually rich but completely deserted')
        .replace(/\b(?:knight|king|queen|bishop)\b/gi, 'abstract chess-piece')
        .replace(/\b(?:humanoid|human-shaped)\s+(?:figures?|robots?|androids?|mechas?|statues?|sculptures?|mannequins?|pieces?)\b/gi, 'abstract non-humanoid structures')
        .replace(/\b(?:robots?|androids?|mechas?|mannequins?|human figures?|humanoid figures?)\b/gi, 'abstract non-humanoid structures')
        .replace(/\b(?:people|persons?|crowds?|audiences?|spectators?|characters?|pedestrians?|passengers?|patrons?|guests?|players?|athletes?|workers?|guards?|soldiers?|warriors?)\b/gi, '')
        .replace(/观众席|观众看台/g, '完全空置的座席区')
        .replace(/繁华|拥挤|热闹|熙熙攘攘/g, '建筑细节丰富且空无一人')
        .replace(/人形(?:人物|雕像|机器人|机甲|人偶)/g, '抽象非人形环境装置')
        .replace(/骑士|国王|王后|皇后|主教/g, '抽象棋子')
        .replace(/人群|观众|行人|游客|顾客|客人|学生|教师|老师|工作人员|服务员|守卫|士兵|战士|角色|人物/g, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([,，。;；])/g, '$1')
        .trim()
}
