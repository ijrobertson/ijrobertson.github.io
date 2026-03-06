const { Resend } = require('resend');

const resend = new Resend('re_6mzE6Wfj_CPfu3sGxts7o1vRvMVeP4iqY');

async function testEmail() {
  try {
    const result = await resend.emails.send({
      from: 'Lingua Bud <notifications@linguabud.com>',
      to: 'ianjack1643@gmail.com', // Change this to your email
      subject: 'Test Email from Resend',
      html: '<h1>Test Email</h1><p>If you receive this, Resend is working!</p>'
    });

    console.log('✅ SUCCESS! Email sent:', result);
  } catch (error) {
    console.log('❌ ERROR:', error);
  }
}

testEmail();
