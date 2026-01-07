const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");

// Routes d'authentification
router.post("/signup", authController.signup);
router.post("/login", authController.login);
router.post("/refresh", authController.refresh);
router.get("/check-email", authController.checkEmail);
router.get("/check-license", authController.checkLicense);
router.post("/email-code", authController.requestEmailCode);
router.post("/email-code/verify", authController.verifyEmailCode);

// Reset mot de passe
router.post("/password-reset/request", authController.requestPasswordResetCode);
router.post("/password-reset/verify", authController.verifyPasswordResetCode);
router.post("/password-reset/confirm", authController.confirmPasswordReset);

module.exports = router;
