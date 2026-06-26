const express = require('express');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const app = express();
const prisma = new PrismaClient();

app.use(express.json());

// Middleware de Validación para HU01 / SINCRO-1 (Padrón Estricto de DNI)
const validarDniComerciante = (req, res, next) => {
    const { dni, nombre } = req.body;
    if (!dni || !/^\d{8}$/.test(dni)) {
        return res.status(400).json({ error: "El DNI es obligatorio y debe contener exactamente 8 dígitos numéricos." });
    }
    if (!nombre || nombre.trim().length < 3) {
        return res.status(400).json({ error: "El nombre es obligatorio y debe tener al menos 3 caracteres." });
    }
    next();
};

// --------------------------------------------------------------------------
// ENDPOINT 1 (SINCRO-1): Registrar y Formalizar un Comerciante
// --------------------------------------------------------------------------
app.post('/api/comerciantes', validarDniComerciante, async (req, res) => {
    const { dni, nombre, telefono } = req.body;
    try {
        const nuevoComerciante = await prisma.comerciante.create({
            data: { dni, nombre, telefono: telefono || "" }
        });
        return res.status(201).json({ mensaje: "Comerciante formalizado con éxito", datos: nuevoComerciante });
    } catch (error) {
        if (error.code === 'P2002') { // Error de código único duplicado en Prisma
            return res.status(400).json({ error: "El DNI ingresado ya se encuentra registrado en el padrón oficial." });
        }
        return res.status(500).json({ error: "Internal Server Error", detalle: error.message });
    }
});

// --------------------------------------------------------------------------
// ENDPOINT 2 (SINCRO-4): Asignación Unívoca de Puestos Físicos
// --------------------------------------------------------------------------
app.post('/api/puestos/asignar', async (req, res) => {
    const { numero, sector, comercianteId } = req.body;
    if (!numero || !sector || !comercianteId) {
        return res.status(400).json({ error: "Número de puesto, sector y comercianteId son campos obligatorios." });
    }
    try {
        // Verificar si el comerciante existe en el padrón
        const comercianteExiste = await prisma.comerciante.findUnique({ where: { id: parseInt(comercianteId) } });
        if (!comercianteExiste) {
            return res.status(404).json({ error: "El comerciante especificado no existe en el padrón." });
        }

        // Buscar o registrar el puesto, validando que no esté ocupado
        const puestoExistente = await prisma.puesto.findUnique({ where: { numero } });
        if (puestoExistente && puestoExistente.estado === "OCUPADO") {
            return res.status(400).json({ error: `El puesto físico N° ${numero} ya se encuentra ocupado por otro comerciante.` });
        }

        const puestoAsignado = await prisma.puesto.upsert({
            where: { numero },
            update: { comercianteId: parseInt(comercianteId), estado: "OCUPADO" },
            create: { numero, sector, comercianteId: parseInt(comercianteId), estado: "OCUPADO" }
        });

        return res.status(200).json({ mensaje: "Puesto asignado legítimamente", datos: puestoAsignado });
    } catch (error) {
        return res.status(500).json({ error: "Error en la transacción de asignación", detalle: error.message });
    }
});

// --------------------------------------------------------------------------
// ENDPOINT 3 (SINCRO-7): Control de Ingreso y Pesaje de Cargamentos
// --------------------------------------------------------------------------
app.post('/api/mercaderia', async (req, res) => {
    const { placaCamion, tipoProducto, tonelaje, comercianteId } = req.body;
    if (!placaCamion || !tipoProducto || !tonelaje || !comercianteId) {
        return res.status(400).json({ error: "Todos los campos de logística de carga son obligatorios." });
    }
    try {
        // Regla de Negocio: Cálculo automático de tasa basado en el peso regulado
        const TASA_POR_TONELADA = 12.50;
        const tarifaCalculada = parseFloat(tonelaje) * TASA_POR_TONELADA;

        const nuevoCargamiento = await prisma.mercaderiaIngreso.create({
            data: {
                placaCamion,
                tipoProducto,
                tonelaje: parseFloat(tonelaje),
                tarifaCalculada,
                comercianteId: parseInt(comercianteId)
            }
        });

        return res.status(201).json({ mensaje: "Ingreso de cargamento autorizado", datos: nuevoCargamiento });
    } catch (error) {
        return res.status(500).json({ error: "Error al insertar el manifiesto de carga", detalle: error.message });
    }
});

// --------------------------------------------------------------------------
// ENDPOINT 4 (SINCRO-10): Historial Cronológico para Comerciantes
// --------------------------------------------------------------------------
app.get('/api/mercaderia/historial/:comercianteId', async (req, res) => {
    const { comercianteId } = req.params;
    try {
        const historial = await prisma.mercaderiaIngreso.findMany({
            where: { comercianteId: parseInt(comercianteId) },
            orderBy: { fechaIngreso: 'desc' }
        });
        return res.status(200).json({ comercianteId, registrosCount: historial.length, historial });
    } catch (error) {
        return res.status(500).json({ error: "Error al consultar la bitácora de auditoría", detalle: error.message });
    }
});

// Ruta base de check para Render
app.get('/', (req, res) => res.send("API SINCRO Operativa y Estable en la Nube."));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor MVP corriendo en puerto ${PORT}`));