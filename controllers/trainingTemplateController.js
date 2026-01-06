const TrainingTemplate = require("../models/TrainingTemplate");

const hasValidSeries = (series) => Array.isArray(series) && series.length > 0;

exports.createTemplate = async (req, res) => {
    try {
        const { title, type, description, equipment, targetIntensity, series, seriesRestInterval, seriesRestUnit } = req.body;

        if (!type || !title || !hasValidSeries(series)) {
            return res.status(400).json({ message: "Type, titre et séries sont requis." });
        }

        const template = await TrainingTemplate.create({
            ownerId: req.user.id,
            title,
            type,
            description,
            equipment,
            targetIntensity,
            series,
            seriesRestInterval,
            seriesRestUnit,
            visibility: "private",
        });

        res.status(201).json(template);
    } catch (error) {
        console.error("Erreur création template:", error);
        if (error?.name === "ValidationError") {
            return res.status(400).json({ message: "Données invalides" });
        }
        res.status(500).json({ message: "Erreur lors de la création du template" });
    }
};

exports.listMyTemplates = async (req, res) => {
    try {
        const templates = await TrainingTemplate.find({ ownerId: req.user.id }).sort({ updatedAt: -1, createdAt: -1 });
        res.json(templates);
    } catch (error) {
        console.error("Erreur liste templates:", error);
        res.status(500).json({ message: "Erreur lors de la récupération des templates" });
    }
};

exports.getTemplateById = async (req, res) => {
    try {
        const template = await TrainingTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ message: "Template introuvable" });
        }
        if (template.ownerId.toString() !== req.user.id) {
            return res.status(403).json({ message: "Vous n'avez pas accès à ce template" });
        }
        res.json(template);
    } catch (error) {
        console.error("Erreur récupération template:", error);
        res.status(500).json({ message: "Erreur lors de la récupération du template" });
    }
};

exports.updateTemplate = async (req, res) => {
    try {
        const template = await TrainingTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ message: "Template introuvable" });
        }
        if (template.ownerId.toString() !== req.user.id) {
            return res.status(403).json({ message: "Vous n'avez pas accès à ce template" });
        }

        const { title, type, description, equipment, targetIntensity, series, seriesRestInterval, seriesRestUnit } = req.body;

        if (!type || !title || !hasValidSeries(series)) {
            return res.status(400).json({ message: "Type, titre et séries sont requis." });
        }

        template.title = title;
        template.type = type;
        template.description = description;
        template.equipment = equipment;
        template.targetIntensity = targetIntensity;
        template.series = series;
        template.seriesRestInterval = seriesRestInterval;
        template.seriesRestUnit = seriesRestUnit;
        template.version = Math.max(1, Number(template.version || 1)) + 1;

        await template.save();
        res.json(template);
    } catch (error) {
        console.error("Erreur mise à jour template:", error);
        if (error?.name === "ValidationError") {
            return res.status(400).json({ message: "Données invalides" });
        }
        res.status(500).json({ message: "Erreur lors de la mise à jour du template" });
    }
};

exports.deleteTemplate = async (req, res) => {
    try {
        const template = await TrainingTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ message: "Template introuvable" });
        }
        if (template.ownerId.toString() !== req.user.id) {
            return res.status(403).json({ message: "Vous n'avez pas accès à ce template" });
        }
        await TrainingTemplate.deleteOne({ _id: template._id });
        res.status(204).send();
    } catch (error) {
        console.error("Erreur suppression template:", error);
        res.status(500).json({ message: "Erreur lors de la suppression du template" });
    }
};
