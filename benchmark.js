var ReedSolomon = require('./index.js');

// Create shards:
var dataShards = 17;
var parityShards = 3;
var totalShards = dataShards + parityShards;
var shardSize = (1024 * 1024 * 8);
var now = Date.now();
var shards = new Array(totalShards);
for (var index = 0; index < totalShards; index++) {
  if (index < dataShards) {
    shards[index] = new Buffer(shardSize);
  } else {
    shards[index] = new Buffer(shardSize);
    shards[index].fill(0);
  }
}

console.log('\nReedSolomon(' + dataShards + ', ' + parityShards + '):');
console.log('');

var bindings = [];
if (ReedSolomon.bindingNative) bindings.push(ReedSolomon.bindingNative);
bindings.push(ReedSolomon.bindingJS);

bindings.forEach(
  function(binding) {
    if (binding === undefined) throw new Error('Binding not defined.');
    if (binding === ReedSolomon.bindingNative) {
      var bindingName = 'Native';
    } else {
      var bindingName = 'Javascript';
    }
    console.log('Binding: ' + bindingName);
    console.log('');

    var encodingResults = [];
    var decodingResults = [];

    // Benchmark several runs of encoding and decoding.
    var times = 5;
    while (times--) {
      // Encode:
      var now = Date.now();
      var reedSolomon = new ReedSolomon(dataShards, parityShards, binding);
      reedSolomon.encode(shards, 0, shardSize);
      var elapsed = (Date.now() - now) / 1000;
      var encoded = dataShards * shardSize / (1024* 1024);
      var rate = 1 / elapsed * encoded;
      encodingResults.push('Encode: ' + rate.toFixed(2) + ' MB/s');
      // Decode:
      var now = Date.now();
      var reedSolomon = new ReedSolomon(dataShards, parityShards, binding);
      var shardsPresent = new Array(totalShards);
      var length = totalShards;
      while (length--) shardsPresent[length] = true;
      shards[0] = new Buffer(shardSize);
      shardsPresent[0] = false;
      shards[1] = new Buffer(shardSize);
      shardsPresent[1] = false;
      shards[totalShards - 1] = new Buffer(shardSize);
      shardsPresent[totalShards - 1] = false;
      reedSolomon.decode(shards, 0, shardSize, shardsPresent);
      var elapsed = (Date.now() - now) / 1000;
      var decoded = dataShards * shardSize / (1024* 1024);
      var rate = 1 / elapsed * decoded;
      decodingResults.push('Decode: ' + rate.toFixed(2) + ' MB/s');
    }

    // Group the encoding and decoding results:
    encodingResults.forEach(
      function(encodingResult) {
        console.log(encodingResult);
      }
    );
    console.log('');
    decodingResults.forEach(
      function(decodingResult) {
        console.log(decodingResult);
      }
    );
    console.log('');
  }
);
