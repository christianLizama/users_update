import mongoose from "mongoose";
const Schema = mongoose.Schema;

let rolesValidos = {
  values: ["ADMIN", "LECTOR", "ADMINAPP", "CONDUCTOR"],
  message: "{VALUE} no es un rol válido",
};

let empresasValidas = {
  values: ["TIR", "TRN"],
  message: "{VALUE} no es una empresa válida",
};

// Función para validar el formato del RUT
function validarRut(rut) {
  if (!/^[0-9]+-[0-9kK]{1}$/.test(rut)) {
    console.log("Formato incorrecto");
    return false; // Formato incorrecto
  }

  const [numero, digitoVerificador] = rut.split("-");
  let suma = 0;
  let multiplicador = 2;

  for (let i = numero.length - 1; i >= 0; i--) {
    suma += parseInt(numero.charAt(i)) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }

  const resultado = 11 - (suma % 11);
  const digitoCalculado =
    resultado === 11 ? "0" : resultado === 10 ? "K" : resultado.toString();

  if (digitoCalculado.toUpperCase() === digitoVerificador.toUpperCase()) {
    console.log("RUT válido");
  }

  return digitoCalculado.toUpperCase() === digitoVerificador.toUpperCase();
}

const UsuarioSchema = new Schema({
  nombreCompleto: {
    type: String,
    required: [true, "El nombre es necesario"],
  },
  rut: {
    type: String,
    required: [true, "El rut es necesario"],
    unique: true,
  },
  email: {
    type: String,
    unique: true,
    required: [true, "El correo es necesario"],
  },
  clave: {
    type: String,
    required: [true, "La contraseña es necesaria"],
  },
  rol: {
    type: String,
    default: "USER",
    required: [true, "El rol es necesario"],
    enum: rolesValidos,
  },
  empresa: {
    type: String,
    required: [true, "La empresa es necesaria"],
    enum: empresasValidas,
  },
  fechaIngreso: {
    type: String,
  },
  fechaTermino: {
    type: String,
  },
});

const usuario = mongoose.model("Usuario", UsuarioSchema);

export default usuario;
