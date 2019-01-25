//Función que valida código de contenedor según ISO 6346
module.exports = {
  valISO6346: function (con) {
      if (!con || con == "" || con.length != 11) { return false; }
      con = con.toUpperCase();
      var re = /^[A-Z]{4}\d{7}/;
      if (re.test(con)) {
          var sum = 0;
          for (i = 0; i < 10; i++) {
              var n = con.substr(i, 1);
              if (i < 4) {
                  n = "0123456789A?BCDEFGHIJK?LMNOPQRSTU?VWXYZ".indexOf(con.substr(i, 1));
              }
              n *= Math.pow(2, i);
              sum += n;
          }
          if (con.substr(0, 4) == "HLCU") {
              sum -= 2;
          }
          sum %= 11;
          sum %= 10;
          return sum == con.substr(10);
      } else {
          return false;
      }
  }
};
