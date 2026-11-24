import { createApp } from 'vue';
import { AboutPage } from '@/app/AboutPage';
import { createAboutI18n } from '@/shared/about-i18n';
import '@/styles/themes/kumo.scss';
import '@/styles/about.css';

const i18n = await createAboutI18n();
createApp(AboutPage, { i18n }).mount('#app');
