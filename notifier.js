const nodemailer = require('nodemailer');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
require('dotenv').config();

async function sendEmail(subject, text, html) {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const receiver = process.env.RECEIVER_EMAIL;

  if (!host || !user || !pass || !receiver) {
    console.error('[Email error] Required SMTP environment variables are missing.');
    return false;
  }

  const transporter = nodemailer.createTransport({
    host,
    port: parseInt(port, 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user,
      pass
    }
  });

  try {
    const info = await transporter.sendMail({
      from: `"Soldout Detective Dog" <${user}>`,
      to: receiver,
      subject,
      text,
      html
    });
    console.log(`[Email success] Message sent. messageId=${info.messageId}`);
    return true;
  } catch (error) {
    console.error('[Email error] Send failed:', error.message);
    return false;
  }
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return false;
  }

  try {
    const response = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'HTML'
    });

    if (response.data && response.data.ok) {
      console.log('[Telegram success] Message sent.');
      return true;
    }
    console.error('[Telegram error] Unexpected response:', response.data);
    return false;
  } catch (error) {
    console.error('[Telegram error] Send failed:', error.message);
    return false;
  }
}

function readPemEnv(value, pathValue) {
  if (pathValue) {
    return fs.readFileSync(pathValue, 'utf8');
  }

  if (!value) {
    return undefined;
  }

  const trimmed = String(value).trim();
  if (trimmed.includes('-----BEGIN')) {
    return trimmed.replace(/\\n/g, '\n');
  }

  return Buffer.from(trimmed, 'base64').toString('utf8');
}

function createTossHttpsAgent() {
  const cert = readPemEnv(process.env.TOSS_MTLS_CERT, process.env.TOSS_MTLS_CERT_PATH);
  const key = readPemEnv(process.env.TOSS_MTLS_KEY, process.env.TOSS_MTLS_KEY_PATH);
  const ca = readPemEnv(process.env.TOSS_MTLS_CA, process.env.TOSS_MTLS_CA_PATH);

  if (!cert || !key) {
    console.error('[Toss alert error] mTLS certificate/key is missing. Set TOSS_MTLS_CERT and TOSS_MTLS_KEY, or TOSS_MTLS_CERT_PATH and TOSS_MTLS_KEY_PATH.');
    return null;
  }

  return new https.Agent({
    cert,
    key,
    ca,
    passphrase: process.env.TOSS_MTLS_PASSPHRASE || undefined,
    rejectUnauthorized: process.env.TOSS_MTLS_REJECT_UNAUTHORIZED !== 'false'
  });
}

function getTossTemplateSetCode(templateSetCode) {
  return templateSetCode || process.env.TOSS_TEMPLATE_SET_CODE || 'ALERT_WATCH_CANCELLATION';
}

function getAxiosErrorDetail(error) {
  if (error.response) {
    return {
      status: error.response.status,
      data: error.response.data
    };
  }

  return {
    message: error.message
  };
}

async function postTossSmartMessage(pathname, userKey, body) {
  const baseUrl = process.env.TOSS_API_BASE_URL || 'https://apps-in-toss-api.toss.im';
  const url = `${baseUrl.replace(/\/+$/, '')}${pathname}`;

  if (!userKey) {
    console.error('[Toss alert error] userKey is missing.');
    return false;
  }

  const httpsAgent = createTossHttpsAgent();
  if (!httpsAgent) {
    return false;
  }

  try {
    const response = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        'x-toss-user-key': userKey
      },
      httpsAgent,
      timeout: 10000
    });

    if (response.data && response.data.resultType === 'SUCCESS') {
      console.log(`[Toss alert success] Message accepted. userKey=${userKey}`);
      return true;
    }

    console.error('[Toss alert error] API returned failure:', response.data && (response.data.error || response.data));
    return false;
  } catch (error) {
    console.error('[Toss alert error] Send failed:', getAxiosErrorDetail(error));
    return false;
  }
}

async function sendTossMessage(userKey, templateSetCode, context) {
  return postTossSmartMessage(
    '/api-partner/v1/apps-in-toss/messenger/send-message',
    userKey,
    {
      templateSetCode: getTossTemplateSetCode(templateSetCode),
      context: context || {}
    }
  );
}

async function sendTossTestMessage(userKey, templateSetCode, deploymentId, context) {
  if (!deploymentId) {
    console.error('[Toss alert error] deploymentId is required for send-test-message.');
    return false;
  }

  return postTossSmartMessage(
    '/api-partner/v1/apps-in-toss/messenger/send-test-message',
    userKey,
    {
      templateSetCode: getTossTemplateSetCode(templateSetCode),
      deploymentId,
      context: context || {}
    }
  );
}

module.exports = {
  sendEmail,
  sendTelegram,
  sendTossMessage,
  sendTossTestMessage
};
