const path = require('node:path');

const root = __dirname;
const apiPort = String(process.env.API_PORT || process.env.PORT || 4188);

module.exports = {
  apps: [
    {
      name: process.env.APP_NAME || 'agent-workflow-platform',
      cwd: root,
      script: path.join(root, 'server', 'server.mjs'),
      interpreter: process.execPath,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: process.env.MAX_MEMORY_RESTART || '1G',
      env: {
        NODE_ENV: 'production',
        API_PORT: apiPort,
        PORT: apiPort,
        STATIC_DIR: process.env.STATIC_DIR || 'dist',
        AWP_ADMIN_USERNAME: process.env.AWP_ADMIN_USERNAME || '',
        AWP_ADMIN_PASSWORD: process.env.AWP_ADMIN_PASSWORD || '',
        AWP_SESSION_MAX_AGE_MS: process.env.AWP_SESSION_MAX_AGE_MS || '',
        AWP_OPERATION_LOG_MAX_ROWS: process.env.AWP_OPERATION_LOG_MAX_ROWS || '10000',
        MYSQL_HOST: process.env.MYSQL_HOST || '',
        MYSQL_PORT: process.env.MYSQL_PORT || '',
        MYSQL_USER: process.env.MYSQL_USER || '',
        MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || '',
        MYSQL_DATABASE: process.env.MYSQL_DATABASE || '',
        MYSQL_CONNECTION_LIMIT: process.env.MYSQL_CONNECTION_LIMIT || '',
        ZENTAO_AUTO_SYNC: process.env.ZENTAO_AUTO_SYNC ?? '0',
        ZENTAO_AUTO_SYNC_PROJECT_ID: process.env.ZENTAO_AUTO_SYNC_PROJECT_ID || 'art_department',
        ZENTAO_AUTO_SYNC_INITIAL_DELAY_MS: process.env.ZENTAO_AUTO_SYNC_INITIAL_DELAY_MS || '5000',
        ZENTAO_AUTO_SYNC_INTERVAL_MS: process.env.ZENTAO_AUTO_SYNC_INTERVAL_MS || String(30 * 60 * 1000),
        ZENTAO_ART_DEPT_ID: process.env.ZENTAO_ART_DEPT_ID || '27',
        ZENTAO_BUG_PRODUCT_IDS: process.env.ZENTAO_BUG_PRODUCT_IDS || 'all'
      },
      error_file: process.env.PM2_ERROR_LOG || path.join(root, 'logs', 'agent-workflow-platform-error.log'),
      out_file: process.env.PM2_OUT_LOG || path.join(root, 'logs', 'agent-workflow-platform-out.log'),
      merge_logs: true,
      time: true
    }
  ]
};
