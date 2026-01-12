const TrainingBlock = require("../models/TrainingBlock");

const isNonEmptyString = (value) => typeof value === "string" && Boolean(value.trim());

const buildDuplicateTitle = (sourceTitle) => {
    const base = isNonEmptyString(sourceTitle) ? sourceTitle.trim() : "Bloc";
    const suffix = " (copie)";
    if (base.toLowerCase().endsWith(suffix)) return base;
    return `${base}${suffix}`;
};

exports.createBlock = async (req, res) => {
    try {
        const { title, segment } = req.body;

        if (!isNonEmptyString(title) || !segment || typeof segment !== "object") {
            return res.status(400).json({ message: "Titre et bloc sont requis." });
        }

        if (!isNonEmptyString(segment.blockType)) {
            return res.status(400).json({ message: "Type de bloc requis." });
        }

        const block = await TrainingBlock.create({
            ownerId: req.user.id,
            title: title.trim(),
            segment,
            version: 1,
        });

        res.status(201).json(block);
    } catch (error) {
        console.error("Erreur création bloc:", error);
        if (error?.name === "ValidationError") {
            return res.status(400).json({ message: "Données invalides" });
        }
        res.status(500).json({ message: "Erreur lors de la création du bloc" });
    }
};

exports.listMyBlocks = async (req, res) => {
    try {
        const blocks = await TrainingBlock.find({ ownerId: req.user.id }).sort({ updatedAt: -1, createdAt: -1 });
        res.json(blocks);
    } catch (error) {
        console.error("Erreur liste blocs:", error);
        res.status(500).json({ message: "Erreur lors de la récupération des blocs" });
    }
};

exports.listLibraryBlocks = async (req, res) => {
    try {
        const blocks = await TrainingBlock.find({
            $or: [{ ownerId: req.user.id }, { isDefault: true }],
        }).sort({ isDefault: -1, updatedAt: -1, createdAt: -1 });
        res.json(blocks);
    } catch (error) {
        console.error("Erreur liste bibliothèque blocs:", error);
        res.status(500).json({ message: "Erreur lors de la récupération des blocs" });
    }
};

exports.getBlockById = async (req, res) => {
    try {
        const block = await TrainingBlock.findById(req.params.id);
        if (!block) {
            return res.status(404).json({ message: "Bloc introuvable" });
        }
        if (!block.isDefault && block.ownerId.toString() !== req.user.id) {
            return res.status(403).json({ message: "Vous n'avez pas accès à ce bloc" });
        }
        res.json(block);
    } catch (error) {
        console.error("Erreur récupération bloc:", error);
        res.status(500).json({ message: "Erreur lors de la récupération du bloc" });
    }
};

exports.updateBlock = async (req, res) => {
    try {
        const block = await TrainingBlock.findById(req.params.id);
        if (!block) {
            return res.status(404).json({ message: "Bloc introuvable" });
        }
        if (block.isDefault) {
            return res.status(403).json({ message: "Les blocs par défaut ne peuvent pas être modifiés" });
        }
        if (block.ownerId.toString() !== req.user.id) {
            return res.status(403).json({ message: "Vous n'avez pas accès à ce bloc" });
        }

        const { title, segment } = req.body;

        if (!isNonEmptyString(title) || !segment || typeof segment !== "object") {
            return res.status(400).json({ message: "Titre et bloc sont requis." });
        }

        if (!isNonEmptyString(segment.blockType)) {
            return res.status(400).json({ message: "Type de bloc requis." });
        }

        block.title = title.trim();
        block.segment = segment;
        block.version = Math.max(1, Number(block.version || 1)) + 1;

        await block.save();
        res.json(block);
    } catch (error) {
        console.error("Erreur mise à jour bloc:", error);
        if (error?.name === "ValidationError") {
            return res.status(400).json({ message: "Données invalides" });
        }
        res.status(500).json({ message: "Erreur lors de la mise à jour du bloc" });
    }
};

exports.deleteBlock = async (req, res) => {
    try {
        const block = await TrainingBlock.findById(req.params.id);
        if (!block) {
            return res.status(404).json({ message: "Bloc introuvable" });
        }
        if (block.isDefault) {
            return res.status(403).json({ message: "Les blocs par défaut ne peuvent pas être supprimés" });
        }
        if (block.ownerId.toString() !== req.user.id) {
            return res.status(403).json({ message: "Vous n'avez pas accès à ce bloc" });
        }
        await TrainingBlock.deleteOne({ _id: block._id });
        res.status(204).send();
    } catch (error) {
        console.error("Erreur suppression bloc:", error);
        res.status(500).json({ message: "Erreur lors de la suppression du bloc" });
    }
};

exports.duplicateBlock = async (req, res) => {
    try {
        const source = await TrainingBlock.findById(req.params.id);
        if (!source) {
            return res.status(404).json({ message: "Bloc introuvable" });
        }

        const canAccess = source.isDefault || source.ownerId.toString() === req.user.id;
        if (!canAccess) {
            return res.status(403).json({ message: "Vous n'avez pas accès à ce bloc" });
        }

        const duplicated = await TrainingBlock.create({
            ownerId: req.user.id,
            title: buildDuplicateTitle(source.title),
            segment: source.segment,
            version: 1,
        });

        return res.status(201).json(duplicated);
    } catch (error) {
        console.error("Erreur duplication bloc:", error);
        res.status(500).json({ message: "Erreur lors de la duplication du bloc" });
    }
};
