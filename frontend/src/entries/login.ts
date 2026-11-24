import { createApp } from 'vue';
import { LoginPage } from '@/app/LoginPage';
import { createLoginI18n } from '@/shared/login-i18n';
import '@/styles/themes/kumo.scss';
import '@/styles/login.css';

const i18n = await createLoginI18n();
createApp(LoginPage, { i18n, fnos: document.documentElement.dataset.termaDistribution === 'fnos' }).mount('#app');
