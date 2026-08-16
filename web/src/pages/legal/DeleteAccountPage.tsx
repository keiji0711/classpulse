import LegalLayout from './LegalLayout';
import { CONTACT_EMAIL } from './legalConstants';

export default function DeleteAccountPage() {
  const subject = encodeURIComponent('Account & Data Deletion Request');
  const body = encodeURIComponent(
    'Please delete my ClassPulse account and associated data.\n\n' +
      'Role (parent / teacher / admin):\nSchool name:\nName on account:\nEmail or LRN used to log in:\n',
  );

  return (
    <LegalLayout title="Delete Your Account & Data" updated="July 27, 2026">
      <p>
        This page explains how to request deletion of your ClassPulse account and the personal
        data associated with it. This is the data-deletion process required by Google Play.
      </p>

      <h2>How to request deletion</h2>
      <p>
        Send a deletion request to{' '}
        <a href={`mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`}>{CONTACT_EMAIL}</a>{' '}
        from the email associated with your account, or use Help &amp; Support inside the app.
        Include the following so we can verify your request:
      </p>
      <ul>
        <li>Your role (parent/guardian, teacher, or school administrator)</li>
        <li>Your school&rsquo;s name</li>
        <li>The name on the account</li>
        <li>The email address or child&rsquo;s LRN used to log in</li>
      </ul>
      <p>
        We will verify your identity and process the request within 30 days, then confirm by
        email when it is complete.
      </p>

      <h2>What gets deleted</h2>
      <ul>
        <li>Your account profile and login credentials</li>
        <li>Parent/guardian contact details (name, email, phone)</li>
        <li>Push notification tokens for your devices</li>
        <li>Support conversation history</li>
      </ul>

      <h2>What may be retained</h2>
      <p>
        Some data may be kept after deletion where we are legally required to, or where it
        belongs to the school rather than to you personally:
      </p>
      <ul>
        <li>
          <strong>Student academic records</strong> (LRN, grades, attendance, exam scores) are
          owned and controlled by the school. Parents cannot unilaterally delete these; requests
          for student records are coordinated with the school administrator, who is the data
          controller.
        </li>
        <li>
          <strong>Transaction and billing records</strong> required for tax, accounting, or
          legal compliance, retained for the period required by law.
        </li>
      </ul>
      <p>
        Retained data is kept only as long as required, then deleted or anonymized.
      </p>

      <h2>Questions</h2>
      <p>
        Contact <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> if you need help with a
        deletion request.
      </p>
    </LegalLayout>
  );
}
