var sqlServer = require ('./bd.json'); //Config SQL y PG
var val = require('./val.js'); //Validador de codigoISO
var pg = require('pg'); //postgre
var sql = require('mssql'); 
var fs = require('fs');
var moment = require('moment');
var connect = require('ssh2-connect');
var exec = require('ssh2-exec');


console.log("Hora actual: " + moment().format('YYYY-MM-DD HH:mm:ss'));

//CONEXION BASE DE DATOS SQL
var pgConnectionString = 'postgres://'+sqlServer.postgres.user+':'+sqlServer.postgres.password+'@'+sqlServer.postgres.host+':'+sqlServer.postgres.port+'/'+sqlServer.postgres.db;
var mssqlConnectionString = 'mssql://'+sqlServer.mssql.user+':'+sqlServer.mssql.password+'@'+sqlServer.mssql.host+'/'+sqlServer.mssql.instance+'/'+sqlServer.mssql.db;

const pool = new sql.ConnectionPool(mssqlConnectionString);

pool.connect();

pool.on('error', err=> {
  if (err) {
    console.log(err)
  }

  if (!err) {
    pool.connect();
  }
})

var client = new pg.Client(pgConnectionString);
client.connect(console.log("\nCONEXION EXITOSA!\n\nLISTENING AT EventoSecuros..."));
client.query('LISTEN "EventoSecuros"');
client.on('notification', function(data) {
  var container = JSON.parse(data.payload);

  if (!container.plate_recognized) {
    console.log('El evento en postgre no fue ingreso de Contenedor');
    return; //Detiene el flujo si el evento no agrega nuevo contenedor
  }
  //Tomamos los datos que necesitamos para validar, desde SecurOS
  var consolidador    = container.lpr_name; // Nombre Consolidador de SecurOS.
  var sentidoContenedor = container.reverse; // Sentido captado por SecurOS, según dirección del paso por portico del contenedor.
  var codigoISO         = container.plate_recognized; // Código ISO del contenedor.
  var listadoCamaras    = container.recorded_camera_list; // Listado de las camaras que captaron el contenedor en cuestion.
  
  /*var fechaSplited = (container.time_enter).split("T");
  var hr = fechaSplited[1].split(".")[0];*/
  // var fechahora = fecha + " " + hr;
  var fechahora = moment().format('YYYY-MM-DD HH:mm:ss');

  console.log("Fecha-hora:" + fechahora);

  if(val.valISO6346(codigoISO)){ //Validación del codigoISO obtenido por SecuOS al pasar un contenedor
    console.log("Código Correcto: " + codigoISO, consolidador, sentidoContenedor);

    switch (consolidador) {
      case 'C Muelle':{
        if(sentidoContenedor === 1){ //Entrada
          nuevopaso({codigoISO, idPortico: 2, fechahora})
        }
        else{ //Salida
          nuevopaso({codigoISO, idPortico: 1, fechahora})
        }
        break;
      }
      
      case 'C Visador':{ //Visador
        // encender_semaforo(2);

        nuevopaso({codigoISO, idPortico: 3, fechahora}, function (result) {
          setTimeout(function () {
            if (!result) {
              encender_semaforo(1);
            } else {
              if (!result.recordset || !result.recordset[0] || !result.recordset[0].autorizado) {
                encender_semaforo(1);
              } else {
                encender_semaforo(3);
              }

              setTimeout(function () {
                apagar_semaforo();
              }, 10000)
            }              
          }, 0);
        })

        break;
      }
      
      case 'C Entrada Calle':{
        nuevopaso({codigoISO, idPortico: 4, fechahora}, function () {
          print({
            codigoISO,
            idPortico: 4
          })
        });
        break;
      }

      case 'C Salida Calle':{
        nuevopaso({codigoISO, idPortico: 5, fechahora}, function () {
          print({
            codigoISO,
            idPortico: 5
          })
        });
        break;
      }

      default:{
        break;
      }
    }
  }
  else{
    
    console.log(`Código incorrecto ${container.plate_recognized}`);
 
    switch (consolidador) {
      //Muelle Entrada - Salida
      case 'C Muelle':{
        if(sentidoContenedor === 0){
          insertacodigoincorrecto(codigoISO, 2, fechahora, listadoCamaras);
        }
        else{
          insertacodigoincorrecto(codigoISO, 1, fechahora, listadoCamaras);
        }
        break;
      }

      case 'C Visador':{
        insertacodigoincorrecto(codigoISO, 3, fechahora, listadoCamaras);
        break;
      }

      case 'C Entrada Calle':{
        insertacodigoincorrecto(codigoISO, 4, fechahora, listadoCamaras);
        break;
      }

      case 'C Salida Calle':{
        idPortico = 5; // 5 Corresponde a Salida Recinto EPA por Calle.
        insertacodigoincorrecto(codigoISO, 5, fechahora, listadoCamaras);
        break;
      }
      default:{
        break;
      }
    }
  }
});

var nuevopaso = async function (data, callback) {
  console.log(data);

  if (!callback) callback = function () {};

  try {
    var q = `NuevoPasoPorPortico ${data.idPortico}, '${data.codigoISO}', '${data.fechahora}'`;
    let result = await pool.request().query(q);
    return callback(result);
  } catch (err) {
    console.log(err)
    return callback();
  } finally {
    
  }
}

var insertacodigoincorrecto = function (codigoISO, idPortico, fechahora, listadoCamaras, callback) {
  
  try {
    sql.close();
  } catch(err) {
    console.log("Error de cierre SQL")
  }

  sql.connect(mssqlConnectionString, err => {
    new sql.Request().query(`EXEC [dbo].[InsertaErrorCodigoISO] @idPortico = ${idPortico}, @codigoISO = '${codigoISO}', @fecha = '${fechahora}', @listaCamaras = '${listadoCamaras}'`, (err, result) => {
      console.log(err);
      sql.close();

      if (callback) callback();
    });
  });
}

var print = function (data) {

  var cmd = require('node-cmd');
  const fs = require('fs');

  String.prototype.toAscii = function() {
      var arr = []
      for (var i=0; i < this.length; i++) {
          arr.push(this[i].charCodeAt(0))
      }
      return arr;
  }

  var text = []
  .concat([27, 33, 60]) //Tamaño 
  .concat(("EPA Austral\n" + (data.idPortico == 4 ? ' Entrada' : 'Salida') + " Muelle Mardones").toAscii())
  .concat([27, 33, 64]) //Tamaño 
  .concat("\n-----------------------------------------------\n".toAscii())
  .concat([29, 33, 54]) //Tamaño 
  .concat((data.codigoISO + '\n').toAscii()) //Texto
  .concat([29, 107, 4])  //Barcode
  .concat(data.codigoISO.toString().toAscii())
  .concat([0])
  .concat('\n'.toAscii()) //Texto
  .concat([27, 33, 64]) //Tamaño
  .concat('\n-----------------------------------------------\n'.toAscii())
  .concat((new Date).toString().toAscii())
  .concat([27, 100, 7, 29, 86, 0]); //Corte


  console.log(("EPA Austral\n" + (data.idPortico == 4 ? 'Entrada' : 'Salida') + " Muelle Mardones"));
  var buffer = new Buffer(text, 'ascii');

  var filePath = 'C:\\Node\\demonio\\1.txt'; 
  fs.writeFile(filePath, buffer, 'ascii');

  var ___print = function () {
    
      cmd.get(`print /D:"\\\\%COMPUTERNAME%\\${(data.idPortico == 4 ? 'Entrada' : 'Salida')}" ` + filePath,
        function(err, data, stderr){
          console.log(err);
            console.log(data);
        }
      );    
  }

  ___print();
}

var encender_semaforo = function (num) {
  console.log("ENCIENDE SWITCH " + num);

  connect({host: '192.168.0.14', port:22, username: 'ubnt', password: 'ubnt', algorithms: { kex: ['diffie-hellman-group1-sha1'], cipher: ['3des-cbc']}}, function(err, ssh){
    exec({cmd: 'echo ' + (num == 1? 1 : 0) + ' > /proc/power/output1; echo ' + (num == 2? 1 : 0) + ' > /proc/power/output2; echo ' + (num == 3? 1 : 0) + ' > /proc/power/output3', ssh:ssh, pty: true});
  });
}

var apagar_semaforo = function (num) {
  connect({host: '192.168.0.14', port:22, username: 'ubnt', password: 'ubnt', algorithms: { kex: ['diffie-hellman-group1-sha1'], cipher: ['3des-cbc']}}, function(err, ssh){
    exec({cmd: 'echo 0 > /proc/power/output1; echo 0 > /proc/power/output2; echo 0 > /proc/power/output3', ssh:ssh, pty: true}, function(err, stdout, stderr){});
  });
}
