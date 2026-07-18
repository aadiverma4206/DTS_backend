const bcrypt = require("bcrypt");

bcrypt.hash("123456", 10).then(console.log);
