import LegalLayout from './LegalLayout';
import { CONTACT_EMAIL, ENTITY_NAME } from './legalConstants';

export default function PrivacyPolicyPage() {
  return (
    <LegalLayout title="Privacy Policy" updated="August 16, 2026">
      <p>
        This Privacy Policy explains how {ENTITY_NAME} (&ldquo;ClassPulse&rdquo;, &ldquo;we&rdquo;,
        &ldquo;us&rdquo;) collects, uses, and protects information when you use the ClassPulse mobile
        app and website. We comply with the Philippine Data Privacy Act of 2012 (Republic Act
        No. 10173) and its implementing rules.
      </p>

      <h2>Who uses ClassPulse</h2>
      <p>
        ClassPulse is a school communication tool used by three types of people: school
        administrators, teachers, and parents/guardians. The app is intended for use by
        adults (school staff and parents). It is not directed to children, and children do not
        create accounts. However, the service necessarily processes information <em>about</em>
        students, who may be minors. That student information is provided and controlled by the
        school, which acts as the data controller; ClassPulse processes it on the school&rsquo;s
        behalf.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li><strong>Student records (provided by the school):</strong> Learner Reference Number (LRN), name, section/strand, attendance records, grades, exam scores, and beginning- and end-of-school-year literacy and numeracy assessments.</li>
        <li><strong>Student wellness information (provided by authorized school staff):</strong> nutritional-status classifications, assessment observations, support indicators, and optional notes shared with the linked parent or guardian.</li>
        <li><strong>Parent/guardian information:</strong> guardian name, and optional email and phone number used for account updates and notifications. Parents log in using their school name, their child&rsquo;s LRN, and a 4-digit PIN they set.</li>
        <li><strong>Teacher &amp; admin information:</strong> name, email address, and class/subject assignments.</li>
        <li><strong>Authentication data:</strong> your password or PIN (stored in hashed/secured form), and session tokens kept securely on your device.</li>
        <li><strong>Push notification tokens:</strong> a device token (via Firebase Cloud Messaging / Apple Push Notification service) so we can deliver attendance, assessment, and announcement notifications.</li>
        <li><strong>Subscription and payment information:</strong> subscription status, product identifier, transaction reference, and payment status. Full payment-card details are handled by the applicable app store or payment provider and are not stored by ClassPulse.</li>
        <li><strong>Support messages:</strong> the content of messages you send through in-app Help &amp; Support.</li>
        <li><strong>Device &amp; diagnostic data:</strong> app version, device type, and language, plus anonymized error and performance logs used to keep the app reliable.</li>
      </ul>

      <h2>How we use your information</h2>
      <ul>
        <li>Deliver attendance, grades, exam scores, learner assessments, support notes, and announcements between authorized school staff and linked parents or guardians.</li>
        <li>Send push notifications for attendance, learner-assessment updates, and school announcements.</li>
        <li>Authenticate you and keep your account secure.</li>
        <li>Respond to your support requests.</li>
        <li>Improve app reliability through anonymized diagnostics.</li>
      </ul>

      <h2>How we share information</h2>
      <p>We do not sell your personal data. We share data only as needed to run the service:</p>
      <ul>
        <li><strong>Within your school&rsquo;s scope:</strong> student data is visible to that student&rsquo;s school staff and linked parents/guardians only.</li>
        <li><strong>Service providers:</strong> Supabase (database, authentication, storage, and server functions), Cloudflare (website delivery and security), Google/Firebase and Apple (push notifications and app distribution), RevenueCat (mobile subscription entitlement processing), PayMongo (supported web payment processing), and our email provider for transactional messages. These providers receive only the information needed to provide their service and process it under their respective privacy and security terms.</li>
        <li><strong>Legal:</strong> when required by law or to protect the rights and safety of users.</li>
      </ul>

      <h2>Data retention</h2>
      <p>
        We keep student academic and assessment records according to the school&rsquo;s approved
        records-retention requirements and while they are needed to provide the service.
        Notification logs, audit records, support records, and completed background jobs may be
        archived or deleted under documented retention rules. Account and personal data is
        deleted, anonymized, or returned after an account is closed, subject to legal and school
        records-retention obligations. See <a href="/delete-account">Delete Account &amp; Data</a>{' '}
        for how to request deletion.
      </p>

      <h2>Your rights</h2>
      <p>Under the Data Privacy Act of 2012, you have the right to access, correct, object to the
        processing of, and request deletion of your personal data. To exercise these rights:</p>
      <ul>
        <li><strong>Parents and students:</strong> contact your school administrator, who controls your records, or email us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</li>
        <li><strong>Teachers and admins:</strong> use in-app Help &amp; Support or email us at the address above.</li>
        <li>You can disable push notifications at any time in your device settings or within the app.</li>
      </ul>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit (HTTPS/TLS). Sensitive credentials are stored using your
        device&rsquo;s secure storage, and access to records is restricted by role and by school.
        No system is perfectly secure, but we work to protect your information using
        industry-standard safeguards.
      </p>

      <h2>Children&rsquo;s privacy</h2>
      <p>
        ClassPulse does not knowingly allow children to create accounts or provide personal
        information directly. Student information is entered and managed by authorized school
        staff. If you believe a child has provided us information directly, contact us and we
        will remove it.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Material changes will be announced
        in the app or on this page, and we will update the &ldquo;Last updated&rdquo; date above.
      </p>

      <h2>Contact us</h2>
      <p>
        For privacy questions or requests, email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>{' '}
        or use Help &amp; Support inside the app. We aim to respond within 1&ndash;2 business days.
      </p>
    </LegalLayout>
  );
}
