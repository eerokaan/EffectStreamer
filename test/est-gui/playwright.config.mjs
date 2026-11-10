import {defineConfig} from '@playwright/test';
import audio from './playwright.audio.config.mjs';
export default defineConfig({...audio,testMatch: /(?:browser-media|remote-flow|experiment)\.spec\.(?:mjs|js)$/,projects:audio.projects.filter(project=>project.name!=='webkit'),timeout:180000,use:{...audio.use,actionTimeout:30000}});
