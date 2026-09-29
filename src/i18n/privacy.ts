import type { Locale } from './config'

type PrivacyCopy = { privacy: string; terms: string; cookies: string; legal: string; back: string; languageNotice: string }

export const PRIVACY_COPY: Record<Locale, PrivacyCopy> = {
    en: {
        privacy: 'Privacy Policy',
        terms: 'Terms of Use',
        cookies: 'Cookie Policy',
        legal: 'Privacy & terms',
        back: 'Back to home',
        languageNotice: 'This document is available in English and Chinese.'
    },
    zh: {
        privacy: '隐私政策',
        terms: '用户协议',
        cookies: 'Cookie 政策',
        legal: '隐私与条款',
        back: '返回首页',
        languageNotice: '本文档提供中文和英文版本。'
    },
    fr: {
        privacy: 'Politique de confidentialité',
        terms: 'Conditions d’utilisation',
        cookies: 'Politique de cookies',
        legal: 'Confidentialité et conditions',
        back: 'Retour à l’accueil',
        languageNotice: 'Ce document est disponible en anglais et en chinois.'
    },
    ar: {
        privacy: 'سياسة الخصوصية',
        terms: 'شروط الاستخدام',
        cookies: 'سياسة ملفات الارتباط',
        legal: 'الخصوصية والشروط',
        back: 'العودة للرئيسية',
        languageNotice: 'هذا المستند متاح باللغتين الإنجليزية والصينية.'
    },
    id: {
        privacy: 'Kebijakan Privasi',
        terms: 'Ketentuan Penggunaan',
        cookies: 'Kebijakan Cookie',
        legal: 'Privasi & ketentuan',
        back: 'Kembali ke beranda',
        languageNotice: 'Dokumen ini tersedia dalam bahasa Inggris dan Mandarin.'
    },
    hi: {
        privacy: 'निजता नीति',
        terms: 'उपयोग की शर्तें',
        cookies: 'कुकी नीति',
        legal: 'निजता और शर्तें',
        back: 'होम पर वापस जाएँ',
        languageNotice: 'यह दस्तावेज़ अंग्रेज़ी और चीनी में उपलब्ध है।'
    },
    fil: {
        privacy: 'Patakaran sa Privacy',
        terms: 'Mga Tuntunin ng Paggamit',
        cookies: 'Patakaran sa Cookie',
        legal: 'Privacy at mga tuntunin',
        back: 'Bumalik sa home',
        languageNotice: 'Available ang dokumentong ito sa Ingles at Tsino.'
    },
    ja: {
        privacy: 'プライバシーポリシー',
        terms: '利用規約',
        cookies: 'Cookie ポリシー',
        legal: 'プライバシーと規約',
        back: 'ホームへ戻る',
        languageNotice: 'この文書は英語と中国語でご覧いただけます。'
    },
    ko: {
        privacy: '개인정보 처리방침',
        terms: '이용약관',
        cookies: '쿠키 정책',
        legal: '개인정보 및 약관',
        back: '홈으로 돌아가기',
        languageNotice: '이 문서는 영어와 중국어로 제공됩니다.'
    }
}
