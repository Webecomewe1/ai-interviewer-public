const emailjs = require('@emailjs/nodejs');
const config = require('../config');

async function sendVerificationEmail(email, code) {
  const serviceId = config.emailjs.serviceId;
  const templateId = config.emailjs.templateId;
  const publicKey = config.emailjs.publicKey;
  const privateKey = config.emailjs.privateKey;

  if (!serviceId || !templateId || !publicKey) {
    console.log(`\n========================================`);
    console.log(`[DEV EMAIL] To: ${email}`);
    console.log(`[DEV EMAIL] Verification Code: ${code}`);
    console.log(`========================================\n`);
    return { success: true, devCode: code };
  }

  try {
    const response = await emailjs.send(
      serviceId,
      templateId,
      {
        email: email,
        to_email: email,
        user_email: email,
        recipient: email,
        verification_code: code,
      },
      {
        publicKey,
        privateKey,
      }
    );
    return { success: true, response };
  } catch (err) {
    console.error('Failed to send verification email via EmailJS:', err.message || err);
    console.log(`\n[FALLBACK DEV EMAIL] Verification Code for ${email}: ${code}\n`);
    throw new Error('Could not send verification email. Please try again later.');
  }
}

module.exports = { sendVerificationEmail };
