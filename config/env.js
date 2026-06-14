require("dotenv").config();
const bcrypt = require("bcrypt");

bcrypt
    .hash(process.env.DEFAULT_PASSWORD, parseInt(process.env.BCRYPT_SALT_ROUNDS))
    .then((hash) => {
        console.log(hash);
    });
