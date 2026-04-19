const fs = require('fs');
console.log('Platform:', process.platform);
console.log('Z: exists:', fs.existsSync('Z:\\'));
console.log('test file:', fs.existsSync('Z:\\nvme11-onosendai13\\Photos\\Feu Artifice 14 juillet 25\\_62A4736.jpg'));
