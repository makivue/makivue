import type { Locale } from './config'

type PwaCopy = { install: string; installing: string; description: string; ios: string; failed: string }

export const pwaCopy: Record<Locale, PwaCopy> = {
    en: {
        install: 'Install makivue',
        installing: 'Installing…',
        description: 'Open makivue from your home screen or desktop.',
        ios: 'In Safari, tap Share, then Add to Home Screen.',
        failed: 'Installation could not start. Try again from your browser’s menu.'
    },
    zh: {
        install: '安装 makivue',
        installing: '正在安装…',
        description: '从主屏幕或桌面快速打开 makivue。',
        ios: '请在 Safari 中点击“分享”，然后选择“添加到主屏幕”。',
        failed: '无法启动安装，请通过浏览器菜单重试。'
    },
    fr: {
        install: 'Installer makivue',
        installing: 'Installation…',
        description: 'Ouvrez makivue depuis votre écran d’accueil ou votre bureau.',
        ios: 'Dans Safari, touchez Partager, puis Sur l’écran d’accueil.',
        failed: 'Impossible de lancer l’installation. Réessayez depuis le menu du navigateur.'
    },
    ar: {
        install: 'تثبيت makivue',
        installing: 'جارٍ التثبيت…',
        description: 'افتح makivue من الشاشة الرئيسية أو سطح المكتب.',
        ios: 'في Safari، اضغط على مشاركة، ثم إضافة إلى الشاشة الرئيسية.',
        failed: 'تعذّر بدء التثبيت. حاول مجددًا من قائمة المتصفح.'
    },
    id: {
        install: 'Instal makivue',
        installing: 'Menginstal…',
        description: 'Buka makivue dari layar utama atau desktop.',
        ios: 'Di Safari, ketuk Bagikan, lalu Tambah ke Layar Utama.',
        failed: 'Instalasi tidak dapat dimulai. Coba lagi dari menu browser.'
    },
    hi: {
        install: 'makivue इंस्टॉल करें',
        installing: 'इंस्टॉल हो रहा है…',
        description: 'होम स्क्रीन या डेस्कटॉप से makivue खोलें।',
        ios: 'Safari में शेयर पर टैप करें, फिर होम स्क्रीन पर जोड़ें चुनें।',
        failed: 'इंस्टॉलेशन शुरू नहीं हो सका। ब्राउज़र के मेन्यू से फिर कोशिश करें।'
    },
    fil: {
        install: 'I-install ang makivue',
        installing: 'Nag-i-install…',
        description: 'Buksan ang makivue mula sa home screen o desktop.',
        ios: 'Sa Safari, i-tap ang Ibahagi, pagkatapos ay Idagdag sa Home Screen.',
        failed: 'Hindi masimulan ang pag-install. Subukang muli mula sa menu ng browser.'
    },
    ja: {
        install: 'makivueをインストール',
        installing: 'インストール中…',
        description: 'ホーム画面やデスクトップからmakivueを開けます。',
        ios: 'Safariで「共有」をタップし、「ホーム画面に追加」を選んでください。',
        failed: 'インストールを開始できませんでした。ブラウザのメニューから再試行してください。'
    },
    ko: {
        install: 'makivue 설치',
        installing: '설치 중…',
        description: '홈 화면이나 데스크톱에서 makivue를 여세요.',
        ios: 'Safari에서 공유를 누른 뒤 홈 화면에 추가를 선택하세요.',
        failed: '설치를 시작할 수 없습니다. 브라우저 메뉴에서 다시 시도하세요.'
    }
}
