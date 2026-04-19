import { existsSync } from 'fs';

const testPath = 'Z:\\nvme11-onosendai13\\Photos\\Feu Artifice 14 juillet 25\\_62A4736.jpg';
console.log('Testing path:', testPath);
console.log('existsSync:', existsSync(testPath));
console.log('Exists:', require('fs').existsSync(testPath));
