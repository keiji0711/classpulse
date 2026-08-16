import LegalLayout from './LegalLayout';
import { CONTACT_EMAIL, ENTITY_NAME } from './legalConstants';

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" updated="July 27, 2026">
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your use of the ClassPulse mobile app
        and website, operated by {ENTITY_NAME}. By creating an account or using ClassPulse, you
        agree to these Terms.
      </p>

      <h2>Using ClassPulse</h2>
      <ul>
        <li>Use the app only for lawful, school-authorized purposes.</li>
        <li>Keep your PIN, password, and device secure. You are responsible for activity under your account.</li>
        <li>Do not attempt to access data belonging to other schools, parents, students, or teachers.</li>
        <li>Do not misuse, disrupt, reverse-engineer, or attempt to gain unauthorized access to the service.</li>
      </ul>

      <h2>Accounts</h2>
      <p>
        School administrators create and manage teacher and student records. Parents log in
        using their school name, their child&rsquo;s Learner Reference Number (LRN), and a PIN
        they set up. You agree that the information you provide is accurate and that you are
        authorized to provide it.
      </p>

      <h2>Service availability</h2>
      <p>
        ClassPulse is provided &ldquo;as is&rdquo; and &ldquo;as available.&rdquo; We aim for high
        availability but cannot guarantee uninterrupted service. Scheduled maintenance and
        occasional outages may occur.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, {ENTITY_NAME} is not liable for indirect,
        incidental, or consequential damages arising from use of the app.
      </p>

      <h2>Termination</h2>
      <p>
        We may suspend or terminate access for violations of these Terms. You may stop using the
        service at any time and request account deletion via{' '}
        <a href="/delete-account">Delete Account &amp; Data</a>.
      </p>

      <h2>Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. Continued use after changes take effect
        constitutes acceptance. Material changes will be announced in the app or on this page.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these Terms? Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>{' '}
        or use Help &amp; Support inside the app.
      </p>
    </LegalLayout>
  );
}
