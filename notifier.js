// Nodemailer를 사용하여 사용자에게 이메일 알림을 전송하는 모듈

const nodemailer = require('nodemailer');
require('dotenv').config();

/**
 * 이메일을 전송합니다.
 * @param {string} subject 메일 제목
 * @param {string} text 메일 본문 내용 (Plain Text)
 * @param {string} html 메일 본문 내용 (HTML)
 * @returns {Promise<boolean>} 전송 성공 여부
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

module.exports = {
  sendEmail
};
