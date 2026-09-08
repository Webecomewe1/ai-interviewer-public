const { connectDB, disconnectDB } = require('../backend/db');
const Question = require('../backend/models/Question');

const ROLE_QUESTIONS = {
  'IT Intern': {
    beginner: [
      'What are the main components of a computer, and what role does each one play?',
      'How does an operating system manage hardware and software resources?',
      'What is the difference between RAM and a hard drive?',
    ],
    intermediate: [
      'Walk me through how you would troubleshoot a computer that will not turn on.',
      'What are the steps you would take to diagnose a slow internet connection?',
      'Explain the difference between a reboot and a shutdown, and when you would use each.',
    ],
    advanced: [
      'How would you handle a situation where multiple devices on a network are intermittently disconnecting?',
      'Describe how you would set up a small office network from scratch, including security considerations.',
    ],
  },
  'IT Generalist Intern': {
    beginner: [
      'What is DNS and why is it important for accessing websites?',
      'What is the difference between DHCP and DNS?',
      'What does an IP address do in network communication?',
    ],
    intermediate: [
      'A user reports a DNS resolution problem. How would you troubleshoot it end to end?',
      'What is the difference between TCP and UDP, and give an example of when each is used.',
      'How would you help a user who cannot connect to the Wi-Fi network?',
    ],
    advanced: [
      'Explain how an email message travels from a sender to a recipient, including the protocols involved.',
      'You deploy a new printer and some computers cannot see it. How do you troubleshoot this?',
    ],
  },
  'Network Technician': {
    beginner: [
      'Explain the OSI model and its seven layers.',
      'What is the difference between a LAN and a WAN?',
      'What is an IP address and what is a subnet mask?',
      'What is the purpose of a router versus a switch?',
    ],
    intermediate: [
      'How would you diagnose intermittent packet loss on a corporate network?',
      'Explain how DHCP assigns IP addresses dynamically.',
      'What is the difference between static and dynamic routing?',
    ],
    advanced: [
      'Explain how recursive DNS resolution works and how you would diagnose intermittent DNS failures.',
      'A network segment is performing slowly. Describe a methodical approach to isolate the cause.',
      'How does NAT help conserve IPv4 addresses, and what are its limitations?',
    ],
  },
  'Web Developer': {
    beginner: [
      'What is the difference between HTML and CSS?',
      'What does an HTTP request and response look like?',
      'What is the difference between a client and a server?',
    ],
    intermediate: [
      'Explain the difference between a GET and a POST request and when you would use each.',
      'How does JavaScript interact with the DOM?',
      'What is an API and how does a web page consume one?',
    ],
    advanced: [
      'Explain how you would improve the page load performance of a web application.',
      'What is a data race in the context of web requests, and how would you prevent one?',
      'Describe how you would secure a web form against common vulnerabilities such as XSS and SQL injection.',
    ],
  },
  'Software Developer': {
    beginner: [
      'What is the difference between an array and a linked list?',
      'What is version control and why does a team use Git?',
      'What is a function and why is it useful in programming?',
    ],
    intermediate: [
      'Explain the difference between an abstract class and an interface.',
      'How would you debug a bug that only appears in production?',
      'Explain the difference between a stack and a queue, with an example for each.',
    ],
    advanced: [
      'Describe a time you had to refactor a poorly structured codebase. How did you approach it?',
      'What are the time and space complexity trade-offs of sorting algorithms?',
      'How would you design a system to handle a sudden spike in traffic without downtime?',
    ],
  },
  'Cybersecurity Intern': {
    beginner: [
      'What is a phishing attack and how would you recognise one?',
      'What is the difference between a virus and a worm?',
      'Why is it important to keep software updated?',
    ],
    intermediate: [
      'Explain the difference between symmetric and asymmetric encryption.',
      'What are the key principles of the CIA triad?',
      'How would you respond to a suspected malware infection on a user machine?',
    ],
    advanced: [
      'Describe how you would harden a Windows workstation for a corporate environment.',
      'Explain a man-in-the-middle attack and how you would defend against it.',
      'How would you design an incident response plan for a security breach?',
    ],
  },
};

async function seed() {
  const conn = await connectDB();
  if (!conn) {
    console.error('MongoDB is not available. Set MONGO_URI and retry.');
    process.exit(1);
  }

  let inserted = 0;
  let skipped = 0;
  const type = 'technical';

  for (const position of Object.keys(ROLE_QUESTIONS)) {
    const byDifficulty = ROLE_QUESTIONS[position];
    for (const difficulty of Object.keys(byDifficulty)) {
      for (const text of byDifficulty[difficulty]) {
        const existing = await Question.findOne({
          position,
          customPosition: '',
          interviewType: type,
          difficulty,
          text,
        });
        if (existing) {
          skipped += 1;
          continue;
        }
        await Question.create({
          position,
          customPosition: '',
          interviewType: type,
          difficulty,
          text,
          isFollowUp: false,
          quality: 7,
          uses: 1,
          selectedCount: 0,
        });
        inserted += 1;
      }
    }
  }

  console.log(`Seed complete. Inserted ${inserted}, skipped ${skipped}.`);
  await disconnectDB();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});