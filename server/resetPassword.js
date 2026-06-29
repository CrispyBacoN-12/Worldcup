// Admin password reset for a player who forgot their password.
// Sets a new password (bcrypt-hashed) for the given username.
// Works against MongoDB when MONGODB_URI is set, otherwise the local files.
//
// Usage:
//   node resetPassword.js <username> <newPassword>
//   MONGODB_URI=... node resetPassword.js <username> <newPassword>   (live DB)
const bcrypt = require('bcryptjs');
const storage = require('./storage');

const main = async () => {
  const [, , username, newPassword] = process.argv;
  if (!username || !newPassword) {
    console.log('Usage: node resetPassword.js <username> <newPassword>');
    process.exit(1);
  }
  if (newPassword.length < 6) {
    console.log('Password must be at least 6 characters.');
    process.exit(1);
  }

  await storage.init();
  const users = await storage.getUsers();
  const user = users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    console.log(`No user found with username "${username}".`);
    process.exit(1);
  }

  user.password = await bcrypt.hash(newPassword, 10);
  await storage.saveUsers(users);
  console.log(`✓ Password reset for "${user.username}". Tell them to log in with the new password.`);
};

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
