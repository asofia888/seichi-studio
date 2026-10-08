import { writeFakeMicFile } from './media';

// Before any browser starts: its fake microphone reads this file
export default function globalSetup() {
  writeFakeMicFile();
}
