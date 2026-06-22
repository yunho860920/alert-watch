import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'soldoutdetectivedog',
  brand: {
    displayName: 'Alert Watch',
    primaryColor: '#3182F6',
    icon: 'https://alert-watch.onrender.com/logo.png',
  },
  web: {
    host: 'localhost',
    port: 3000,
    commands: {
      dev: 'npm run dev',
      build: 'npm run prepare:ait',
    },
  },
  webViewProps: {
    type: 'partner',
  },
  navigationBar: {
    withBackButton: true,
    withHomeButton: true,
  },
  permissions: [],
  outdir: 'dist/apps-in-toss',
});
