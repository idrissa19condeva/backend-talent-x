const express = require("express");
const auth = require("../midlewares/authMiddleware");
const trainingGroupController = require("../controllers/trainingGroupController");
const trainingController = require("../controllers/trainingController");

const router = express.Router();

router.post("/", auth, trainingGroupController.createGroup);
router.get("/", auth, trainingGroupController.searchGroups);
router.get("/mine", auth, trainingGroupController.listMyGroups);
router.get("/:id/sessions", auth, trainingController.listGroupSessions);
router.get("/:id", auth, trainingGroupController.getGroup);
router.patch("/:id", auth, trainingGroupController.updateGroup);
router.delete("/:id", auth, trainingGroupController.deleteGroup);
router.post("/:id/join", auth, trainingGroupController.joinGroup);
router.post("/:id/requests/:userId/accept", auth, trainingGroupController.acceptJoinRequest);
router.delete("/:id/requests/:userId", auth, trainingGroupController.rejectJoinRequest);
router.post("/:id/invites/accept", auth, trainingGroupController.acceptMemberInvite);
router.delete("/:id/invites", auth, trainingGroupController.declineMemberInvite);
router.delete("/:id/invites/:userId", auth, trainingGroupController.cancelMemberInvite);
router.post("/:id/sessions", auth, trainingController.attachSessionToGroup);
router.delete("/:id/sessions/:sessionId", auth, trainingController.detachSessionFromGroup);
router.post("/:id/members", auth, trainingGroupController.addMember);
router.delete("/:id/members/:memberId", auth, trainingGroupController.removeMember);

module.exports = router;
