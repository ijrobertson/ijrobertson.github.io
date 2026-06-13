/**
 * One-time script to send a preview of the student engagement email to the admin.
 * Run from the functions/ directory: RESEND_API_KEY=<key> node send-student-engagement-preview.js
 */
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const ADMIN_EMAIL = 'ianjack1643@gmail.com';

function buildStudentEngagementEmail(firstName) {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Lingua Bud</title>
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f7f6;">
  <table role="presentation" style="width:100%;border-collapse:collapse;background:#f4f7f6;">
    <tr><td align="center" style="padding:32px 16px;">

      <!-- Card -->
      <table role="presentation" style="width:600px;max-width:100%;border-collapse:collapse;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.10);">

        <!-- Header -->
        <tr>
          <td style="background:#20bcba;padding:36px 40px;text-align:center;">
            <img src="https://linguabud.com/images/NewLogo8.png" alt="Lingua Bud" style="height:52px;margin-bottom:14px;display:block;margin-left:auto;margin-right:auto;" />
            <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;line-height:1.3;">Your language journey starts here!</h1>
            <p style="margin:10px 0 0;color:#e0fffe;font-size:15px;">We're so glad you joined the Lingua Bud community.</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#ffffff;padding:40px;">

            <p style="font-size:16px;color:#333;margin:0 0 8px;">Hi ${firstName},</p>
            <p style="font-size:15px;color:#555;line-height:1.7;margin:0 0 28px;">
              Whether you're picking up a new language from scratch or leveling up skills you already have,
              Lingua Bud has everything you need. Here's what you can do right now:
            </p>

            <!-- Feature 1: Connect -->
            <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:20px;">
              <tr>
                <td style="background:#f0fffe;border-left:4px solid #20bcba;border-radius:0 8px 8px 0;padding:20px 24px;">
                  <table role="presentation" style="width:100%;border-collapse:collapse;">
                    <tr>
                      <td style="vertical-align:top;padding-right:16px;width:40px;">
                        <div style="background:#20bcba;border-radius:50%;width:36px;height:36px;text-align:center;line-height:36px;font-size:18px;">💬</div>
                      </td>
                      <td style="vertical-align:top;">
                        <strong style="color:#113448;font-size:16px;display:block;margin-bottom:6px;">Chat with other learners — completely free</strong>
                        <p style="margin:0;color:#555;font-size:14px;line-height:1.6;">
                          Head to the <strong>Connect</strong> tab to find language partners from around the world.
                          Practice conversation, exchange tips, and build friendships — no cost, no commitment.
                        </p>
                        <p style="margin:14px 0 0;">
                          <a href="https://linguabud.com/connect"
                             style="display:inline-block;background:#20bcba;color:#ffffff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px;">
                            Go to Connect &rarr;
                          </a>
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- Feature 2: Book a Lesson -->
            <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:28px;">
              <tr>
                <td style="background:#f0f4ff;border-left:4px solid #113448;border-radius:0 8px 8px 0;padding:20px 24px;">
                  <table role="presentation" style="width:100%;border-collapse:collapse;">
                    <tr>
                      <td style="vertical-align:top;padding-right:16px;width:40px;">
                        <div style="background:#113448;border-radius:50%;width:36px;height:36px;text-align:center;line-height:36px;font-size:18px;">🎓</div>
                      </td>
                      <td style="vertical-align:top;">
                        <strong style="color:#113448;font-size:16px;display:block;margin-bottom:6px;">Book a lesson with a real instructor</strong>
                        <p style="margin:0;color:#555;font-size:14px;line-height:1.6;">
                          Browse our vetted, passionate instructors and find the perfect match for your goals,
                          schedule, and budget. Every new instructor offers a <strong>free 15-minute trial</strong> — no commitment required.
                        </p>
                        <p style="margin:14px 0 0;">
                          <a href="https://linguabud.com/instructors"
                             style="display:inline-block;background:#113448;color:#ffffff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px;">
                            Browse Instructors &rarr;
                          </a>
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- Divider -->
            <hr style="border:none;border-top:1px solid #eee;margin:0 0 28px;" />

            <!-- New Features -->
            <h2 style="font-size:17px;color:#113448;margin:0 0 16px;">&#10024; What's new on Lingua Bud</h2>

            <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:12px;">
              <tr>
                <td style="vertical-align:top;padding:14px 18px;background:#fff8e1;border:1px solid #ffe082;border-radius:8px;margin-bottom:12px;">
                  <strong style="color:#b45309;font-size:14px;">&#128190; Screen sharing on video calls</strong>
                  <p style="margin:6px 0 0;color:#555;font-size:14px;line-height:1.6;">
                    During your live lessons, you and your instructor can now share your screen — making it easy
                    to work through documents, websites, exercises, and more together in real time.
                  </p>
                </td>
              </tr>
            </table>

            <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:28px;">
              <tr>
                <td style="vertical-align:top;padding:14px 18px;background:#fff8e1;border:1px solid #ffe082;border-radius:8px;">
                  <strong style="color:#b45309;font-size:14px;">&#128203; Homework assignments</strong>
                  <p style="margin:6px 0 0;color:#555;font-size:14px;line-height:1.6;">
                    Your instructor can now assign homework directly through the platform — exercises, reading,
                    or practice tasks to keep your progress going between lessons. Check your
                    <a href="https://linguabud.com/bookings" style="color:#20bcba;text-decoration:none;font-weight:bold;">Bookings</a> page to see any assignments.
                  </p>
                </td>
              </tr>
            </table>

            <!-- Main CTA -->
            <div style="text-align:center;margin-top:4px;">
              <a href="https://linguabud.com/connect"
                 style="display:inline-block;background:#20bcba;color:#ffffff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;margin:6px 8px;">
                Find a Language Partner
              </a>
              <a href="https://linguabud.com/instructors"
                 style="display:inline-block;background:#113448;color:#ffffff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;margin:6px 8px;">
                Book a Lesson
              </a>
            </div>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#113448;padding:28px 40px;text-align:center;border-top:none;">
            <img src="https://linguabud.com/images/NewLogo8.png" alt="Lingua Bud" style="height:32px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;" />
            <p style="margin:0;font-size:13px;color:#ffffff;line-height:1.8;">
              The Lingua Bud Team<br />
              <a href="https://linguabud.com" style="color:#20bcba;text-decoration:none;">linguabud.com</a>
              &nbsp;|&nbsp;
              <a href="mailto:support@linguabud.com" style="color:#20bcba;text-decoration:none;">support@linguabud.com</a>
            </p>
            <p style="margin:12px 0 0;font-size:12px;color:#8aaabb;line-height:1.5;">
              You're receiving this email because you recently created a Lingua Bud account.<br />
              Questions? We're always happy to help at
              <a href="mailto:support@linguabud.com" style="color:#20bcba;text-decoration:none;">support@linguabud.com</a>
            </p>
            <p style="margin:8px 0 0;font-size:11px;color:#6a8898;">&copy; ${year} Lingua Bud</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function main() {
  console.log('Sending student engagement email preview to', ADMIN_EMAIL, '...');
  const result = await resend.emails.send({
    from: 'Lingua Bud <notifications@linguabud.com>',
    to: ADMIN_EMAIL,
    subject: '[PREVIEW] Student Welcome Email — sent to new students on signup',
    html: buildStudentEngagementEmail('Ian'),
  });

  if (result.error) {
    console.error('Resend error:', result.error);
    process.exit(1);
  }

  console.log('✓ Preview sent to', ADMIN_EMAIL, '— email ID:', result.data?.id);
}

main().catch(err => { console.error(err); process.exit(1); });
