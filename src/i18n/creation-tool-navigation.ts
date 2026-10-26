import type { Locale } from './config'
import type { ToolSlug } from './creation-tool-config'

const baseNavigation = {
    en: {
        label: 'AI image & video tools',
        heading: 'Choose how to create your next image or video',
        intro: 'Start with a description or a reference image. Explore the workflow, then open the image or video workspace.',
        related: 'Image and video creation workflows',
        input: 'Start with',
        output: 'Create',
        workflow: 'Workflow',
        comparison: [
            { slug: 'text-to-image', input: 'A written picture description', output: 'A new still image or visual concept' },
            { slug: 'image-to-image', input: 'A reference picture and a change description', output: 'A new still image guided by the reference' },
            { slug: 'text-to-video', input: 'A scene and motion description', output: 'A video clip within the selected model’s limits' },
            { slug: 'image-to-video', input: 'A reviewed picture and a motion description', output: 'A video clip guided by the image' }
        ],
        tools: {
            'ai-image-generator': 'AI image generator',
            'text-to-image': 'Text to image AI',
            'image-to-image': 'Image to image AI',
            'text-to-video': 'Text to video AI',
            'image-to-video': 'Image to video AI'
        }
    },
    zh: {
        label: 'AI 图片与视频工具',
        heading: '选择适合当前素材的图片与视频创作方式',
        intro: '从文字描述或参考图片开始，先了解对应流程，再进入图片或视频创作台。',
        related: '图片与视频创作方式',
        input: '从什么开始',
        output: '生成什么',
        workflow: '创作方式',
        comparison: [
            { slug: 'text-to-image', input: '一段画面文字描述', output: '新的静态图片或视觉概念图' },
            { slug: 'image-to-image', input: '参考图片与修改要求', output: '由参考图引导生成的新图片' },
            { slug: 'text-to-video', input: '场景与运动描述', output: '所选模型时长范围内的视频片段' },
            { slug: 'image-to-video', input: '已确认的图片与运动描述', output: '由图片引导生成的动态片段' }
        ],
        tools: {
            'ai-image-generator': 'AI 图片生成器',
            'text-to-image': '文生图：文字生成图片',
            'image-to-image': '图生图：参考图片生成',
            'text-to-video': '文生视频：文字生成视频',
            'image-to-video': '图生视频：图片生成视频'
        }
    }
} as const

type ToolNavigation = {
    label: string
    heading: string
    intro: string
    related: string
    input: string
    output: string
    workflow: string
    comparison: readonly { slug: ToolSlug; input: string; output: string }[]
    tools: Record<ToolSlug, string>
}
const navigationEditions = {
    fr: {
        label: 'Outils IA pour images et vidéos',
        heading: 'Choisissez comment créer votre prochaine image ou vidéo',
        intro: 'Partez d’une description ou d’une image de référence. Découvrez le processus, puis ouvrez l’atelier adapté.',
        related: 'Parcours de création d’images et de vidéos',
        input: 'Point de départ',
        output: 'Résultat',
        workflow: 'Méthode',
        tools: {
            'ai-image-generator': 'Générateur d’images IA',
            'text-to-image': 'Texte vers image IA',
            'image-to-image': 'Image vers image IA',
            'text-to-video': 'Texte vers vidéo IA',
            'image-to-video': 'Image vers vidéo IA'
        },
        inputs: ['Description d’une image', 'Image de référence et modification souhaitée', 'Scène et mouvement décrits', 'Image validée et mouvement décrit'],
        outputs: ['Nouvelle image fixe', 'Nouvelle image guidée par la référence', 'Clip selon les limites du modèle', 'Clip guidé par l’image']
    },
    id: {
        label: 'Alat gambar dan video AI',
        heading: 'Pilih cara membuat gambar atau video berikutnya',
        intro: 'Mulai dari deskripsi atau gambar referensi. Pelajari alurnya, lalu buka ruang kerja yang sesuai.',
        related: 'Alur pembuatan gambar dan video',
        input: 'Bahan awal',
        output: 'Hasil',
        workflow: 'Cara membuat',
        tools: {
            'ai-image-generator': 'Generator gambar AI',
            'text-to-image': 'Teks menjadi gambar AI',
            'image-to-image': 'Gambar menjadi gambar AI',
            'text-to-video': 'Teks menjadi video AI',
            'image-to-video': 'Gambar menjadi video AI'
        },
        inputs: ['Deskripsi gambar', 'Gambar referensi dan perubahan yang diminta', 'Deskripsi adegan dan gerakan', 'Gambar yang diperiksa dan deskripsi gerakan'],
        outputs: ['Gambar diam baru', 'Gambar baru dengan panduan referensi', 'Klip sesuai batas model', 'Klip dengan panduan gambar']
    },
    fil: {
        label: 'Mga AI tool para sa larawan at video',
        heading: 'Piliin kung paano sisimulan ang susunod mong larawan o video',
        intro: 'Magsimula sa paglalarawan o larawang sanggunian. Alamin ang proseso, saka buksan ang tamang workspace.',
        related: 'Mga paraan ng paggawa ng larawan at video',
        input: 'Panimulang materyal',
        output: 'Resulta',
        workflow: 'Paraan',
        tools: {
            'ai-image-generator': 'AI image generator',
            'text-to-image': 'Teksto tungo sa larawan',
            'image-to-image': 'Larawan tungo sa bagong larawan',
            'text-to-video': 'Teksto tungo sa video',
            'image-to-video': 'Larawan tungo sa video'
        },
        inputs: ['Paglalarawan ng larawan', 'Larawang sanggunian at nais na pagbabago', 'Paglalarawan ng eksena at galaw', 'Sinuring larawan at paglalarawan ng galaw'],
        outputs: ['Bagong larawang hindi gumagalaw', 'Bagong larawang ginabayan ng sanggunian', 'Clip ayon sa limitasyon ng modelo', 'Clip na ginabayan ng larawan']
    },
    ja: {
        label: 'AI画像・動画制作ツール',
        heading: '次の画像や動画に合う制作方法を選ぶ',
        intro: '文章や参考画像から始めましょう。手順を確認して、画像または動画の制作画面を開きます。',
        related: '画像・動画制作のワークフロー',
        input: '用意するもの',
        output: '生成するもの',
        workflow: '制作方法',
        tools: {
            'ai-image-generator': 'AI画像生成ツール',
            'text-to-image': '文章から画像を生成',
            'image-to-image': '参考画像から新しい画像を生成',
            'text-to-video': '文章から動画を生成',
            'image-to-video': '画像から動画を生成'
        },
        inputs: ['画像の文章説明', '参考画像と変更内容', '場面と動きの説明', '確認済みの画像と動きの説明'],
        outputs: ['新しい静止画像', '参考画像を基にした新しい画像', 'モデルの制限内の動画クリップ', '画像を基にした動画クリップ']
    },
    ko: {
        label: 'AI 이미지·영상 제작 도구',
        heading: '다음 이미지나 영상에 맞는 제작 방법을 선택하세요',
        intro: '설명이나 참조 이미지로 시작하세요. 제작 과정을 확인한 뒤 이미지 또는 영상 작업 화면을 여세요.',
        related: '이미지·영상 제작 과정',
        input: '시작 자료',
        output: '생성 결과',
        workflow: '제작 방법',
        tools: {
            'ai-image-generator': 'AI 이미지 생성기',
            'text-to-image': '텍스트로 이미지 생성',
            'image-to-image': '참조 이미지로 새 이미지 생성',
            'text-to-video': '텍스트로 영상 생성',
            'image-to-video': '이미지로 영상 생성'
        },
        inputs: ['이미지 설명', '참조 이미지와 변경 요청', '장면과 움직임 설명', '확인한 이미지와 움직임 설명'],
        outputs: ['새 정지 이미지', '참조 자료를 바탕으로 만든 새 이미지', '모델의 길이 제한 내 영상 클립', '이미지를 바탕으로 만든 영상 클립']
    },
    ar: {
        label: 'أدوات الصور والفيديو بالذكاء الاصطناعي',
        heading: 'اختر طريقة إنشاء صورتك أو مقطعك التالي',
        intro: 'ابدأ بوصف نصي أو صورة مرجعية. تعرّف على الخطوات ثم افتح مساحة العمل المناسبة.',
        related: 'مسارات إنشاء الصور والفيديو',
        input: 'نقطة البداية',
        output: 'الناتج',
        workflow: 'الطريقة',
        tools: {
            'ai-image-generator': 'مولّد صور بالذكاء الاصطناعي',
            'text-to-image': 'تحويل النص إلى صورة',
            'image-to-image': 'إنشاء صورة من صورة مرجعية',
            'text-to-video': 'تحويل النص إلى فيديو',
            'image-to-video': 'تحويل الصورة إلى فيديو'
        },
        inputs: ['وصف نصي للصورة', 'صورة مرجعية ووصف التغيير', 'وصف المشهد والحركة', 'صورة تمّت مراجعتها ووصف للحركة'],
        outputs: ['صورة ثابتة جديدة', 'صورة جديدة تسترشد بالمرجع', 'مقطع ضمن حدود النموذج', 'مقطع يسترشد بالصورة']
    },
    hi: {
        label: 'AI चित्र और वीडियो बनाने के उपकरण',
        heading: 'अपने अगले चित्र या वीडियो के लिए तरीका चुनें',
        intro: 'लिखित विवरण या संदर्भ चित्र से शुरू करें। प्रक्रिया समझें, फिर सही चित्र या वीडियो कार्यक्षेत्र खोलें।',
        related: 'चित्र और वीडियो बनाने की प्रक्रियाएँ',
        input: 'शुरुआती सामग्री',
        output: 'परिणाम',
        workflow: 'तरीका',
        tools: {
            'ai-image-generator': 'AI चित्र जनरेटर',
            'text-to-image': 'टेक्स्ट से चित्र',
            'image-to-image': 'संदर्भ चित्र से नया चित्र',
            'text-to-video': 'टेक्स्ट से वीडियो',
            'image-to-video': 'चित्र से वीडियो'
        },
        inputs: ['चित्र का लिखित विवरण', 'संदर्भ चित्र और बदलाव का विवरण', 'दृश्य और गति का विवरण', 'जाँचा हुआ चित्र और गति का विवरण'],
        outputs: ['नया स्थिर चित्र', 'संदर्भ के आधार पर नया चित्र', 'मॉडल की सीमा के भीतर वीडियो क्लिप', 'चित्र के आधार पर वीडियो क्लिप']
    }
}
function navigationFor(edition: (typeof navigationEditions)[keyof typeof navigationEditions]): ToolNavigation {
    return {
        ...edition,
        comparison: (['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video'] as const).map((slug, index) => ({ slug, input: edition.inputs[index], output: edition.outputs[index] }))
    }
}
export const toolNavigation: Record<Locale, ToolNavigation> = {
    ...baseNavigation,
    fr: navigationFor(navigationEditions.fr),
    ar: navigationFor(navigationEditions.ar),
    id: navigationFor(navigationEditions.id),
    hi: navigationFor(navigationEditions.hi),
    fil: navigationFor(navigationEditions.fil),
    ja: navigationFor(navigationEditions.ja),
    ko: navigationFor(navigationEditions.ko)
}
