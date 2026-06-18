// Nodemailer를 사용하여 사용자에게 이메일 알림을 전송하는 모듈
const nodemailer = require('nodemailer');
const axios = require('axios');
require('dotenv').config();

/**
 * 이메일을 전송합니다.
 */
async function sendEmail(subject, text, html) {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const receiver = process.env.RECEIVER_EMAIL;

  if (!host || !user || !pass || !receiver) {
    console.error('[이메일 오류] 이메일 발신에 필요한 환경 변수가 .env 파일에 누락되어 전송을 취소합니다.');
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: host,
    port: parseInt(port, 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: user,
      pass: pass
    }
  });

  const mailOptions = {
    from: `"취소표 알리미" <${user}>`,
    to: receiver,
    subject: subject,
    text: text,
    html: html
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[이메일 성공] 알림 이메일 전송이 완료되었습니다. MessageID: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('[이메일 오류] 메일 전송 중 에러가 발생했습니다.', error);
    return false;
  }
}

/**
 * 텔레그램 메시지를 전송합니다.
 */
async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const response = await axios.post(url, {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML'
    });
    if (response.data && response.data.ok) {
      console.log('[텔레그램 성공] 알림 메시지 전송 완료');
      return true;
    }
    return false;
  } catch (error) {
    console.error('[텔레그램 오류] 메시지 전송 중 에러:', error.message);
    return false;
  }
}

/**
 * 토스 스마트 발송 API를 사용하여 기능성 알림 메시지를 발송합니다.
 */
async function sendTossMessage(userKey, templateSetCode, context) {
  const baseUrl = process.env.TOSS_API_BASE_URL || 'https://apps-in-toss-api.toss.im';
  const url = `${baseUrl}/api-partner/v1/apps-in-toss/messenger/send-message`;

  if (!userKey) {
    console.error('[토스 알림 오류] 발송 대상 userKey가 누락되었습니다.');
    return false;
  }

  try {
    const response = await axios.post(url, {
      templateSetCode: templateSetCode || process.env.TOSS_TEMPLATE_SET_CODE || 'ALERT_WATCH_CANCELLATION',
      context: context
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-toss-user-key': userKey
      },
      timeout: 5000
    });

    if (response.data && response.data.resultType === 'SUCCESS') {
      console.log(`[토스 알림 성공] 메시지 전송 완료. userKey: ${userKey}`);
      return true;
    } else {
      console.error('[토스 알림 실패] 응답 에러:', response.data.error || response.data);
      return false;
    }
  } catch (error) {
    console.error('[토스 알림 오류] 전송 실패:', error.message);
    return false;
  }
}

module.exports = {
  sendEmail,
  sendTelegram,
  sendTossMessage
};

