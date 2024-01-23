import express from "express";
import cors from "cors";
import cron from "node-cron";
import axios from "axios";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import Usuario from "./models/Usuario.js";
import Evento from "./models/Evento.js";
import mongoose from "mongoose";

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Conexión a la base de datos

const uri = process.env.MONGO_URI;
const options = {};

mongoose.connect(uri, options).then(
  (client) => {
    console.log("Conectado a DB");
  },
  (err) => {
    console.log(err);
  }
);

// Middleware CORS
app.use(cors());

// Función para obtener y procesar los datos
const obtenerDatos = async (emp) => {
  try {
    const variables = {
      usuario: process.env.USUARIO_API,
      contrasena: process.env.PASSWORD_API,
      empresa: emp,
    };
    let usuario = variables.usuario;
    let contrasena = variables.contrasena;
    let empresa = variables.empresa;

    // Autenticación para obtener el token
    const urlDestino = process.env.URL_API_USERS;
    const urlAutenticar = urlDestino + "Autenticar";
    const bodyAutenticar = { usuario, contrasena };
    const responseAutenticar = await axios.post(urlAutenticar, bodyAutenticar);
    const token = responseAutenticar.data.token;

    // Llamada a la API externa con el token obtenido
    const url = urlDestino + "auditeris/getemployee";
    let empresaRut = "";
    if (empresa === "TRN") {
      empresaRut = process.env.RUT_TRN;
    } else if (empresa === "TIR") {
      empresaRut = process.env.RUT_TIR;
    }

    const headers = {
      Authorization: token,
      "Content-Type": "application/json",
    };
    const bodyAPI = {
      rut_empresa: empresaRut,
      movimientos_personal: "S",
    };
    const responseAPI = await axios.get(url, {
      headers: headers,
      data: bodyAPI,
    });

    // Filtrar usuarios por cargo "Conductor" y obtener email, nombre completo y rut
    const usuarios = responseAPI.data.result.filter((user) =>
      user.contrato.cargo.toLowerCase().includes("conductor")
    );

    const conductoresInfo = usuarios.map((user) => ({
      nombreCompleto: user.ficha.nombrecompleto,
      rut: user.ficha.rut,
      email: user.ficha.email,
      rol: "CONDUCTOR",
      empresa: empresa,
      clave: bcrypt.hashSync(user.ficha.rut, 10),
      fechaIngreso: user.contrato.fechaingreso,
      fechaTermino: user.contrato.fechatermino,
      ausentismo: user.ausentismo,
      vacaciones: user.vacaciones.solicitudes,
    }));

    // Verificar correos electrónicos duplicados en la API
    const apiEmails = conductoresInfo.map((conductor) => conductor.email);
    const duplicateApiEmails = apiEmails.filter(
      (email, index) => apiEmails.indexOf(email) !== index
    );

    // Verificar correos electrónicos duplicados en la base de datos
    const existingEmails = await Usuario.find({ email: { $in: apiEmails } });
    const dbEmails = existingEmails.map((user) => user.email);
    const duplicateDbEmails = dbEmails.filter(
      (email, index) => dbEmails.indexOf(email) !== index
    );

    // Manejar correos electrónicos duplicados
    const allDuplicateEmails = [...duplicateApiEmails, ...duplicateDbEmails];
    const updatedEmails = new Set();

    conductoresInfo.forEach((conductor) => {
      if (allDuplicateEmails.includes(conductor.email)) {
        let updatedEmail = conductor.email;
        let index = 1;

        // Agregar un número al final hasta que sea único
        while (updatedEmails.has(updatedEmail)) {
          updatedEmail = `${conductor.email}_${index}`;
          index++;
        }

        updatedEmails.add(updatedEmail);
        conductor.email = updatedEmail;
      }
    });

    let conductoresActualizados = 0;
    let conductoresCreados = 0;

    // Continuar con la lógica para crear o actualizar conductores en la base de datos
    for (const conductor of conductoresInfo) {
      let existe = await Usuario.findOne({ rut: conductor.rut });

      if (existe) {
        // Si existe el conductor, hay que actualizarlo excluyendo el campo "email"
        const updateData = {
          $set: {
            ...conductor,
            email: existe.email, // Mantén el valor actual del email
            clave: existe.clave, // Mantén el valor actual de la clave
          },
        };
        await Usuario.findOneAndUpdate({ rut: conductor.rut }, updateData);
        conductoresActualizados++;
        const eventos = crearEventosConductor(
          existe,
          conductor.ausentismo,
          conductor.vacaciones
        );
        // Eliminar eventos anteriores del conductor que tengan la misma fecha
        const eventosEliminados = await Evento.deleteMany({
          user: existe._id,
          fecha: { $in: eventos.map((evento) => evento.fecha) },
        });

        // console.log("Eventos eliminados:", eventosEliminados.deletedCount);

        // Crear eventos nuevos
        await Evento.insertMany(eventos);
      } else {
        // Si no existe, crear el conductor
        const newUser = await Usuario.create(conductor);
        conductoresCreados++;
        const eventos = crearEventosConductor(
          newUser,
          conductor.ausentismo,
          conductor.vacaciones
        );
        await Evento.insertMany(eventos);
      }
    }
    console.log("-----------------------");
    console.log("Conductores creados:", conductoresCreados);
    console.log("Conductores actualizados:", conductoresActualizados);
    const fechaEjecucion = dayjs()
      .tz("America/Santiago")
      .format("YYYY-MM-DD HH:mm:ss");
    console.log(
      `La función obtenerDatos se ejecutó el ${fechaEjecucion} para la empresa ${empresa}`
    );
    console.log("-----------------------");
  } catch (error) {
    console.error("Error al obtener datos:", error.message);
  }
};

// Función para crear eventos a partir de las fechas de ausentismo o vacaciones
const crearEventosConductor = (conductor, ausentismo, vacaciones) => {
  const eventos = [];

  // Función para agregar evento de tipo licencia en un rango de fechas
  const agregarEventos = (desde, hasta, nombre, descripcion) => {
    // console.log(conductor.nombreCompleto, desde, hasta, nombre, descripcion);
    const [diaDesde, mesDesde, anioDesde] = desde.split("/").map(Number);
    const [diaHasta, mesHasta, anioHasta] = hasta.split("/").map(Number);

    let fechaInicio = new Date(anioDesde, mesDesde - 1, diaDesde);
    const fechaFin = new Date(anioHasta, mesHasta - 1, diaHasta);

    while (fechaInicio <= fechaFin) {
      let nombreModifcado = descripcion.toLowerCase();
      // console.log(nombreModifcado);
      if (nombreModifcado.includes("licencia")) {
        nombre = "licencia";
      } else if (nombre === "vacacion") {
        nombre = "vacacion";
      } else {
        nombre = "ausentismo";
      }

      eventos.push({
        nombre,
        descripcion,
        fecha: new Date(fechaInicio),
        user: conductor._id,
        tipo: descripcion,
      });

      fechaInicio.setDate(fechaInicio.getDate() + 1);
    }
  };

  // Agregar eventos para ausentismo si existe y no es "N/A"
  if (ausentismo && ausentismo !== "N/A") {
    ausentismo.forEach((ausentismo) => {
      agregarEventos(
        ausentismo.desde,
        ausentismo.hasta,
        "ausentismo",
        ausentismo.tipo
      );
    });
  }

  // Agregar eventos para vacaciones si existe y no es undefined
  if (vacaciones && vacaciones !== undefined) {
    vacaciones.forEach((vacacion) => {
      if (vacacion.inicio !== undefined && vacacion.termino !== undefined) {
        agregarEventos(
          vacacion.inicio,
          vacacion.termino,
          "vacacion",
          "Vacaciones"
        );
      } else if (
        vacacion.progresivas_inicio !== undefined &&
        vacacion.progresivas_termino
      ) {
        agregarEventos(
          vacacion.progresivas_inicio,
          vacacion.progresivas_termino,
          "vacacion",
          "Vacaciones Progresivas"
        );
      }
    });
  }

  return eventos;
};

//obtenerDatos();

// Configurar las horas de ejecución en formato cron
const cronStrings = ["0 6 * * *", "0 14 * * *", "0 17 * * *"]; // Cadenas cron para 6 am, 2 pm y 5 pm

//Ejecutar la primera vez al iniciar el servidor
obtenerDatos("TRN");
obtenerDatos("TIR");

// Programar la ejecución de la función obtenerDatos en las horas especificadas
cronStrings.forEach((horaCron) => {
  cron.schedule(horaCron, () => obtenerDatos("TRN"), {
    timezone: "America/Santiago",
  });
});

cronStrings.forEach((horaCron) => {
  cron.schedule(horaCron, () => obtenerDatos("TIR"), {
    timezone: "America/Santiago",
  });
});

app.listen(port, () => {
  console.log(`Servidor corriendo en el puerto ${port}`);
});
