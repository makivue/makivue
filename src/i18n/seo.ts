import type { Locale } from './config'
import type { SeoPageSlug } from '@/lib/seo-pages'
import { SITE_NAME } from '@/lib/seo'

// The shared social image uses English for the international brand; page metadata is localized below.
export const SEO_SOCIAL_IMAGE_COPY = {
    category: 'YOUR AI SHORT DRAMA STUDIO',
    headline: ['Your stories.', 'Brought to life.'],
    capabilities: 'Scripts · Images · Videos · Series',
    storage: 'YOUR LOCAL WORKSPACE',
    storageLabel: 'Local',
    storageNote: 'Your projects. Your model account.'
}

export const SEO_LOCALE: Record<
    Locale,
    {
        html: string
        openGraph: string
        title: string
        description: string
        offerDescription: string
        keywords: string[]
    }
> = {
    en: {
        html: 'en-US',
        openGraph: 'en_US',
        title: `AI Short Drama & Animation Studio | ${SITE_NAME}`,
        description: `Create AI short dramas with ${SITE_NAME}: scripts, characters, storyboards and video Explore Seedance video and AI image tools`,
        offerDescription: 'Use your own model account. Supplier usage charges apply.',
        keywords: ['AI short drama generator', 'AI animated stories', 'script to video', 'AI video generator', 'AI image generator', 'Seedance', 'Nano Banana']
    },
    zh: {
        html: 'zh-CN',
        openGraph: 'zh_CN',
        title: `AI 短剧生成器与 AI 漫剧制作 | ${SITE_NAME}`,
        description: `${SITE_NAME} AI 短剧生成器，串联剧本创作、角色设计、AI 分镜与视频合成。 支持 Seedance 等视频模型、Nano Banana 等图片模型，也可独立使用文生视频、图生视频与 AI 图片工具。`,
        offerDescription: 'Use your own model account. Supplier usage charges apply.',
        keywords: ['AI短剧生成器', 'AI漫剧制作', '小说转视频', 'AI分镜生成器', 'AI视频生成器', 'AI图片生成器', 'Seedance', 'Nano Banana']
    },
    fr: {
        html: 'fr-FR',
        openGraph: 'fr_FR',
        title: `Mini-séries IA et histoires animées | ${SITE_NAME}`,
        description: `Créez des mini-séries IA avec ${SITE_NAME} : scénario, personnages, storyboard et vidéo Découvrez Seedance et les outils d’image IA`,
        offerDescription: 'Use your own model account. Supplier usage charges apply.',
        keywords: ['générateur de mini-séries IA', 'histoires animées IA', 'scénario en vidéo', 'générateur vidéo IA', 'générateur d’images IA', 'Seedance', 'Nano Banana']
    },
    ar: {
        html: 'ar',
        openGraph: 'ar_AR',
        title: `مسلسلات قصيرة وقصص متحركة بالذكاء الاصطناعي | ${SITE_NAME}`,
        description: `أنشئ مسلسلات قصيرة مع ${SITE_NAME}، من النص والشخصيات ولوحات المشاهد إلى الفيديو جرّب Seedance وأدوات توليد الصور بالذكاء الاصطناعي`,
        offerDescription: 'Use your own model account. Supplier usage charges apply.',
        keywords: [
            'مولّد مسلسلات قصيرة بالذكاء الاصطناعي',
            'قصص متحركة بالذكاء الاصطناعي',
            'تحويل النص إلى فيديو',
            'مولّد فيديو بالذكاء الاصطناعي',
            'مولّد صور بالذكاء الاصطناعي',
            'Seedance',
            'Nano Banana'
        ]
    },
    id: {
        html: 'id-ID',
        openGraph: 'id_ID',
        title: `Generator Drama Pendek AI & Cerita Animasi | ${SITE_NAME}`,
        description: `Buat drama pendek AI di ${SITE_NAME}: naskah, karakter, storyboard, hingga video Coba Seedance dan alat gambar AI`,
        offerDescription: 'Use your own model account. Supplier usage charges apply.',
        keywords: ['generator drama pendek AI', 'cerita animasi AI', 'naskah menjadi video', 'generator video AI', 'generator gambar AI', 'Seedance', 'Nano Banana']
    },
    hi: {
        html: 'hi-IN',
        openGraph: 'hi_IN',
        title: `AI शॉर्ट ड्रामा जनरेटर और एनिमेटेड कहानियाँ | ${SITE_NAME}`,
        description: `${SITE_NAME} में स्क्रिप्ट, पात्र, स्टोरीबोर्ड और वीडियो से AI शॉर्ट ड्रामा बनाएँ। Seedance वीडियो और AI इमेज टूल आज़माएँ।`,
        offerDescription: 'Use your own model account. Supplier usage charges apply.',
        keywords: ['AI शॉर्ट ड्रामा जनरेटर', 'AI एनिमेटेड कहानियाँ', 'स्क्रिप्ट से वीडियो', 'AI वीडियो जनरेटर', 'AI इमेज जनरेटर', 'Seedance', 'Nano Banana']
    },
    fil: {
        html: 'fil-PH',
        openGraph: 'fil_PH',
        title: `AI Short Drama Generator at Animated Stories | ${SITE_NAME}`,
        description: `Gumawa ng AI short drama sa ${SITE_NAME}: iskrip, tauhan, storyboard at video Subukan ang Seedance at AI image tools`,
        offerDescription: 'Use your own model account. Supplier usage charges apply.',
        keywords: ['AI short drama generator', 'AI animated stories', 'iskrip tungo sa video', 'AI video generator', 'AI image generator', 'Seedance', 'Nano Banana']
    },
    ja: {
        html: 'ja-JP',
        openGraph: 'ja_JP',
        title: `AIショートドラマ生成・アニメ制作 | ${SITE_NAME}`,
        description: `${SITE_NAME}で脚本、キャラクター、絵コンテからAIショートドラマを制作。 Seedanceなどの動画モデルやNano Bananaなどの画像モデルで素材も生成できます。`,
        offerDescription: '以降の生成料金は利用量に応じてプリペイド残高から差し引かれます。',
        keywords: ['AIショートドラマ生成', 'AIアニメ制作', '脚本から動画', 'AI動画生成', 'AI画像生成', 'Seedance', 'Nano Banana']
    },
    ko: {
        html: 'ko-KR',
        openGraph: 'ko_KR',
        title: `AI 숏드라마 생성기와 애니메이션 제작 | ${SITE_NAME}`,
        description: `${SITE_NAME}에서 대본, 캐릭터, 스토리보드부터 AI 숏드라마를 제작하세요 Seedance 영상 모델과 Nano Banana 이미지 모델로 소재도 만들 수 있습니다`,
        offerDescription: 'Use your own model account. Supplier usage charges apply.',
        keywords: ['AI 숏드라마 생성기', 'AI 애니메이션 제작', '대본을 영상으로', 'AI 영상 생성기', 'AI 이미지 생성기', 'Seedance', 'Nano Banana']
    }
}

type FeatureMetadata = Record<SeoPageSlug, { title: string; description: string }>

export const SEO_FEATURE_LOCALE: Record<Locale, FeatureMetadata> = {
    en: {
        'ai-short-drama-generator': {
            title: 'AI Short Drama Generator',
            description: 'Create AI short dramas with consistent characters, scripts, storyboards, video scenes, and subtitles in one studio.'
        },
        'ai-storyboard-generator': {
            title: 'AI Storyboard Generator',
            description: 'Turn scripts into AI storyboards with framing, camera movement, dialogue, prompts, and first and last frame references.'
        },
        'ai-video-generator': {
            title: 'AI Video Generator — Text to Video',
            description: 'Generate AI video from text or images, guide shots with references, add dialogue with supported models, and assemble episodes.'
        }
    },
    zh: {
        'ai-short-drama-generator': {
            title: 'AI 短剧生成器 — 从故事创意到完整成片',
            description: '在一个工作流中完成短剧剧本、角色一致性、分镜、画面、带原声视频和多语言字幕，生成可发布的 AI 短剧。'
        },
        'ai-storyboard-generator': {
            title: 'AI 分镜生成器 — 把剧本转成可执行镜头',
            description: '将小说或剧本拆解为结构化分镜，自动生成景别、机位、运镜、动作、对白、提示词和首尾帧参考。'
        },
        'ai-video-generator': {
            title: 'AI 视频生成器 — 多模型生成镜头并合成短剧',
            description: '使用多种 AI 视频模型按分镜生成带原声镜头，通过关键帧控制画面，并完成字幕、失败重试与整集合成。'
        }
    },
    fr: {
        'ai-short-drama-generator': {
            title: 'Générateur de mini-séries IA — De l’idée à la vidéo finale',
            description: 'Créez scénario, personnages cohérents, storyboard, plans avec audio natif et sous-titres, puis produisez une mini-série IA prête à publier dans un seul flux.'
        },
        'ai-storyboard-generator': {
            title: 'Générateur de storyboard IA — Du scénario aux plans prêts à produire',
            description: 'Transformez un scénario en plans structurés avec cadrage, mouvements de caméra, actions, dialogues, prompts et images clés de début et de fin.'
        },
        'ai-video-generator': {
            title: 'Générateur vidéo IA — Créez et assemblez une mini-série',
            description: 'Générez chaque plan avec son audio natif via plusieurs modèles vidéo IA, contrôlez le résultat par images clés, puis ajoutez les sous-titres et le montage final.'
        }
    },
    ar: {
        'ai-short-drama-generator': {
            title: 'مولّد المسلسلات القصيرة بالذكاء الاصطناعي — من الفكرة إلى الفيديو',
            description: 'أنشئ النص والشخصيات المتسقة ولوحات المشاهد واللقطات بصوتها الأصلي والترجمات، ثم أخرج مسلسلًا قصيرًا جاهزًا للنشر ضمن سير عمل واحد.'
        },
        'ai-storyboard-generator': {
            title: 'مولّد لوحات المشاهد بالذكاء الاصطناعي — من النص إلى لقطات جاهزة',
            description: 'حوّل النص إلى لقطات منظمة تشمل حجم اللقطة وحركة الكاميرا والحركة والحوار والأوامر والصور المرجعية الأولى والأخيرة.'
        },
        'ai-video-generator': {
            title: 'مولّد فيديو بالذكاء الاصطناعي — إنشاء مشاهد الدراما القصيرة وتجميعها',
            description: 'أنشئ لقطات بصوتها الأصلي بعدة نماذج فيديو، واضبطها بالإطارات المفتاحية، ثم أضف الترجمة وإعادة المحاولة وتجميع الحلقة النهائية.'
        }
    },
    id: {
        'ai-short-drama-generator': {
            title: 'Generator Drama Pendek AI — Dari Ide Cerita hingga Video Jadi',
            description: 'Buat naskah, karakter konsisten, storyboard, adegan dengan audio bawaan, dan subtitel, lalu hasilkan drama pendek AI siap tayang dalam satu alur kerja.'
        },
        'ai-storyboard-generator': {
            title: 'Generator Storyboard AI — Ubah Naskah Menjadi Shot Siap Produksi',
            description: 'Ubah naskah menjadi shot terstruktur lengkap dengan framing, gerak kamera, aksi, dialog, prompt, serta referensi frame awal dan akhir.'
        },
        'ai-video-generator': {
            title: 'Generator Video AI — Buat dan Rangkai Adegan Drama Pendek',
            description: 'Buat setiap shot beserta audio bawaannya dengan berbagai model video AI, kendalikan melalui keyframe, lalu selesaikan subtitel, pengulangan, dan penyusunan episode.'
        }
    },
    hi: {
        'ai-short-drama-generator': {
            title: 'AI शॉर्ट ड्रामा जनरेटर — कहानी के विचार से तैयार वीडियो तक',
            description: 'एक ही वर्कफ़्लो में स्क्रिप्ट, एकरूप पात्र, स्टोरीबोर्ड, मूल ऑडियो वाले दृश्य और उपशीर्षक बनाएँ और प्रकाशन के लिए तैयार AI शॉर्ट ड्रामा पाएँ।'
        },
        'ai-storyboard-generator': {
            title: 'AI स्टोरीबोर्ड जनरेटर — स्क्रिप्ट को तैयार शॉट्स में बदलें',
            description: 'स्क्रिप्ट को फ़्रेमिंग, कैमरा मूवमेंट, ऐक्शन, संवाद, प्रॉम्प्ट और शुरुआती व अंतिम फ़्रेम संदर्भ वाले व्यवस्थित शॉट्स में बदलें।'
        },
        'ai-video-generator': {
            title: 'AI वीडियो जनरेटर — शॉर्ट ड्रामा के दृश्य बनाएँ और जोड़ें',
            description: 'कई AI वीडियो मॉडल से मूल ऑडियो वाले शॉट बनाएँ, कीफ़्रेम से परिणाम नियंत्रित करें और फिर उपशीर्षक, पुनः प्रयास व अंतिम एपिसोड संयोजन पूरा करें।'
        }
    },
    fil: {
        'ai-short-drama-generator': {
            title: 'AI Short Drama Generator — Mula Ide hanggang Kumpletong Video',
            description: 'Gumawa ng iskrip, pare-parehong karakter, storyboard, eksenang may native audio, at subtitle, at bumuo ng AI short drama na handa nang i-publish sa iisang workflow.'
        },
        'ai-storyboard-generator': {
            title: 'AI Storyboard Generator — Gawing Production-Ready Shots ang Iskrip',
            description: 'Hatiin ang iskrip sa maayos na shots na may framing, galaw ng camera, aksyon, dayalogo, prompt, at reference para sa una at huling frame.'
        },
        'ai-video-generator': {
            title: 'AI Video Generator — Gumawa at Magbuo ng Short-Drama Scenes',
            description: 'Gumawa ng shots na may native audio gamit ang iba’t ibang AI video model, kontrolin sa keyframes, at kumpletuhin ang subtitle, retry, at final episode assembly.'
        }
    },
    ja: {
        'ai-short-drama-generator': {
            title: 'AIショートドラマ生成 — アイデアから完成動画まで',
            description: '脚本、キャラクターの一貫性、絵コンテ、音声付き映像、字幕をひとつのワークフローで制作し、公開可能なAIショートドラマに仕上げます。'
        },
        'ai-storyboard-generator': {
            title: 'AI絵コンテ生成 — 脚本を制作可能なカットへ変換',
            description: '脚本を構図、カメラワーク、動作、セリフ、プロンプト、開始・終了フレームを含む構造化されたカットへ自動変換します。'
        },
        'ai-video-generator': {
            title: 'AI動画生成 — ショートドラマのカット制作と一括編集',
            description: '複数のAI動画モデルで音声付きカットを生成し、キーフレームで制御。 字幕、再生成、エピソード全体の結合まで行えます。'
        }
    },
    ko: {
        'ai-short-drama-generator': {
            title: 'AI 숏드라마 생성기 — 이야기 아이디어부터 완성 영상까지',
            description: '대본, 일관된 캐릭터, 스토리보드, 원음 포함 장면, 자막을 하나의 작업 흐름에서 제작해 바로 공개할 수 있는 AI 숏드라마를 완성하세요.'
        },
        'ai-storyboard-generator': {
            title: 'AI 스토리보드 생성기 — 대본을 제작 가능한 숏으로 변환',
            description: '대본을 구도, 카메라 움직임, 동작, 대사, 프롬프트, 시작·종료 프레임 참조가 포함된 구조화된 숏으로 변환합니다.'
        },
        'ai-video-generator': {
            title: 'AI 영상 생성기 — 숏드라마 장면 생성과 에피소드 합성',
            description: '여러 AI 영상 모델로 원음 포함 숏을 만들고 키프레임으로 제어한 뒤 자막, 재시도, 최종 에피소드 합성까지 진행하세요.'
        }
    }
}
