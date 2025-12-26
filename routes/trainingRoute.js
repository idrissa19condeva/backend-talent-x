const express = require("express");
const auth = require("../midlewares/authMiddleware");
const trainingController = require("../controllers/trainingController");

const router = express.Router();

router.post("/", auth, trainingController.createSession);
router.get("/", auth, trainingController.listSessions);
router.get("/participations", auth, trainingController.listParticipantSessions);
router.get("/:id", auth, trainingController.getSessionById);
router.post("/:id/join", auth, trainingController.joinSession);
router.post("/:id/leave", auth, trainingController.leaveSession);
router.post("/:id/participants", auth, trainingController.addParticipantToSession);
router.delete("/:id/participants/:participantId", auth, trainingController.removeParticipantFromSession);
router.put("/:id/chronos", auth, trainingController.saveChronos);
router.put("/:id", auth, trainingController.updateSession);
router.delete("/:id", auth, trainingController.deleteSession);

module.exports = router;
