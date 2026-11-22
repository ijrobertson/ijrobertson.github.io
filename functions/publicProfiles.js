// Fields copied from users/{uid} and instructors/{uid} into the public
// publicUsers/{uid} and publicInstructors/{uid} documents (2026-11-17).
// Allowlist on purpose: anything not named here (email, payout details,
// Stripe IDs, referral tokens, marketing flags…) stays private.
// Used by the sync triggers in index.js and by backfill-public-profiles.js.
const PUBLIC_USER_FIELDS = [
  'name', 'avatar_url', 'about_me', 'country', 'native_country',
  'languages_spoken', 'languages_learning', 'languages_teaching', 'interests',
  'role', 'status', 'isApproved', 'acceptingRequests', 'hasInstructorApplication',
  'lastActiveAt', 'createdAt', 'timezone',
];
const PUBLIC_INSTRUCTOR_FIELDS = [
  'name', 'avatar_url', 'about_me', 'languages_spoken', 'languages_teaching',
  'native_country', 'price_per_lesson', 'currency', 'status', 'isApproved',
  'timezone', 'certifications', 'intro_video_url', 'teaching_experience',
  'teaching_style', 'isFoundingInstructor', 'averageRating', 'reviewCount',
  'lessonsCount', 'createdAt', 'updatedAt', 'approvedAt',
  'stripeOnboardingComplete', 'chargesEnabled', 'payoutsEnabled', 'payoutMethod',
];
function pickPublic(data, fields) {
  const out = {};
  for (const f of fields) if (data[f] !== undefined) out[f] = data[f];
  return out;
}
function publicInstructorCopy(data) {
  const out = pickPublic(data, PUBLIC_INSTRUCTOR_FIELDS);
  // Same test the booking pages used to do with the private payout fields.
  out.paymentReady = (data.chargesEnabled === true && data.payoutsEnabled === true)
    || (data.payoutMethod === 'wise' && !!data.wiseEmail);
  return out;
}
// Parent accounts (2026-11-22, booking lessons for a child): only what an
// instructor needs to recognise them in Messages and Calendar is public — no
// bio, country, languages or interests — plus the markers the pages use to
// keep them off Connect and closed to messages from anyone but instructors.
const PARENT_PUBLIC_FIELDS = ['name', 'avatar_url', 'role', 'timezone', 'createdAt', 'lastActiveAt'];
function publicUserCopy(data) {
  if (data && data.accountType === 'parent') {
    const out = pickPublic(data, PARENT_PUBLIC_FIELDS);
    out.accountType = 'parent';
    out.acceptingRequests = false;
    return out;
  }
  return pickPublic(data, PUBLIC_USER_FIELDS);
}

module.exports = { PUBLIC_USER_FIELDS, PUBLIC_INSTRUCTOR_FIELDS, publicUserCopy, publicInstructorCopy };
