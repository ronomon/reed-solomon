var Node = { crypto: require('crypto') };
var QueueStream = require('./queue-stream.js');
var ReedSolomon = require('./index.js');

var Test = {};

Test.equal = function(value, expected, namespace, description) {
  value = JSON.stringify(value) + '';
  expected = JSON.stringify(expected) + '';
  if (value === expected) {
    Test.pass(namespace, description, expected);
  } else {
    Test.fail(namespace, description, value + ' !== ' + expected);
  }
};

Test.fail = function(namespace, description, message) {
  console.log('');
  throw 'FAIL: ' + Test.message(namespace, description, message);
};

Test.message = function(namespace, description, message) {
  if ((namespace = namespace || '')) namespace += ': ';
  if ((description = description || '')) description += ': ';
  return namespace + description + (message || '');
};

Test.pass = function(namespace, description, message) {
  console.log('PASS: ' + Test.message(namespace, description, message));
};

function CheckParity(
  dataShards,
  parityShards,
  buffer,
  bufferOffset,
  bufferSize,
  shardLength,
  shardOffset,
  shardSize
) {
  var totalShards = dataShards + parityShards;
  var matrix = ReedSolomon.matrix(dataShards, totalShards);
  var matrixRows = [];
  for (var index = 0; index < parityShards; index++) {
    matrixRows.push(matrix.getRow(dataShards + index));
  }
  if (shardOffset + shardSize > shardLength) {
    throw new Error('shard overflow');
  }
  var shards = [];
  for (var index = 0; index < totalShards; index++) {
    if (bufferOffset + shardLength > buffer.length) {
      throw new Error('buffer overflow');
    }
    var shard = buffer.slice(bufferOffset, bufferOffset += shardLength);
    shards.push(shard.slice(shardOffset, shardOffset + shardSize));
  }
  var sources = shards.slice(0, dataShards);
  var targets = shards.slice(dataShards);
  if (targets.length !== parityShards) {
    throw new Error('targets.length !== parityShards');
  }
  var temp = Buffer.alloc(shardSize);
  var table = ReedSolomon.Galois.TABLE;
  var targetsLength = targets.length;
  var sourcesLength = sources.length;
  for (var targetsIndex = 0; targetsIndex < targetsLength; targetsIndex++) {
    var target = targets[targetsIndex];
    var matrixRow = matrixRows[targetsIndex];
    for (var sourcesIndex = 0; sourcesIndex < sourcesLength; sourcesIndex++) {
      var source = sources[sourcesIndex];
      var tableOffset = matrixRow[sourcesIndex] * 256;
      var tableRow = table.slice(tableOffset, tableOffset + 256);
      if (sourcesIndex === 0) {
        for (var index = 0; index < shardSize; index++) {
          temp[index] = tableRow[source[index]];
        }
      } else {
        for (var index = 0; index < shardSize; index++) {
          temp[index] ^= tableRow[source[index]];
        }
      }
    }
    for (var index = 0; index < shardSize; index++) {
      if (temp[index] != target[index]) return false;
    }
  }
  return true;
}

var actual = ReedSolomon.Matrix.identity(3).toString();
var expect = '[[1, 0, 0], [0, 1, 0], [0, 0, 1]]';
Test.equal(actual, expect, 'Matrix', 'identity(3).toString()');

var m1 = new ReedSolomon.Matrix([
  Buffer.from([1, 2]),
  Buffer.from([3, 4])
]);
var m2 = new ReedSolomon.Matrix([
  Buffer.from([5, 6]),
  Buffer.from([7, 8])
]);
var actual = m1.times(m2).toString();
var expect = '[[11, 22], [19, 42]]';
Test.equal(actual, expect, 'Matrix', 'times');

var m = new ReedSolomon.Matrix([
  Buffer.from([56, 23, 98]),
  Buffer.from([3, 100, 200]),
  Buffer.from([45, 201, 123])
]);
Test.equal(
  m.invert().toString(),
  "[[175, 133, 33], [130, 13, 245], [112, 35, 126]]",
  'Matrix',
  'invert'
);
Test.equal(
  m.times(m.invert()).toString(),
  ReedSolomon.Matrix.identity(3).toString(),
  'Matrix',
  'invert'
);

var m = new ReedSolomon.Matrix([
  Buffer.from([1, 0, 0, 0, 0]),
  Buffer.from([0, 1, 0, 0, 0]),
  Buffer.from([0, 0, 0, 1, 0]),
  Buffer.from([0, 0, 0, 0, 1]),
  Buffer.from([7, 7, 6, 6, 1])
]);
var expected = '[' + [
  '[1, 0, 0, 0, 0]',
  '[0, 1, 0, 0, 0]',
  '[123, 123, 1, 122, 122]',
  '[0, 0, 1, 0, 0]',
  '[0, 0, 0, 1, 0]'
].join(', ') + ']';
Test.equal(m.invert().toString(), expected, 'Matrix', 'invert2');
Test.equal(
  m.times(m.invert()).toString(),
  ReedSolomon.Matrix.identity(5).toString(),
  'Matrix',
  'invert3'
);

var assertEqualsCount = 0;

function assertEquals(a, b, namespace, name, mod) {
  assertEqualsCount++;
  // We always assert that a and b are equal (using a !== b).
  // We only explicitly log these results every mod times.
  // We test millions of iterations so this helps the test to run faster.
  if (a !== b || (assertEqualsCount % mod) === 0) {
    Test.equal(a, b, namespace, name);
  }
}

function assertArrayEquals(a, b, namespace, name) {
  var passed = true;
  if (a.length !== b.length) {
    passed = false;
  } else {
    for (var index = 0, length = a.length; index < length; index++) {
      if (a[index] !== b[index]) {
        passed = false;
        break;
      }
    }
  }
  Test.equal(passed, true, namespace, name);
}

// // Test associativity:
// for (var a = 0; a < 256; a++) {
//   for (var b = 0; b < 256; b++) {
//     for (var c = 0; c < 256; c++) {
//       assertEquals(
//         ReedSolomon.Galois.add(a, ReedSolomon.Galois.add(b, c)),
//         ReedSolomon.Galois.add(ReedSolomon.Galois.add(a, b), c),
//         'Galois',
//         'associativity',
//         2000000
//       );
//       assertEquals(
//         ReedSolomon.Galois.multiply(a, ReedSolomon.Galois.multiply(b, c)),
//         ReedSolomon.Galois.multiply(ReedSolomon.Galois.multiply(a, b), c),
//         'Galois',
//         'associativity',
//         2000000
//       );
//     }
//   }
// }
//
// // Test identity:
// for (var a = 0; a < 256; a++) {
//   assertEquals(a, ReedSolomon.Galois.add(a, 0), 'Galois', 'identity', 32);
//   assertEquals(a, ReedSolomon.Galois.multiply(a, 1), 'Galois', 'identity', 32);
// }
//
// // Test inverse:
// for (var a = 0; a < 256; a++) {
//   var b = ReedSolomon.Galois.subtract(0, a);
//   assertEquals(0, ReedSolomon.Galois.add(a, b), 'Galois', 'inverse', 64);
//   if (a !== 0) {
//     var b = ReedSolomon.Galois.divide(1, a);
//     assertEquals(1, ReedSolomon.Galois.multiply(a, b), 'Galois', 'inverse', 13);
//   }
// }
//
// // Test commutativity:
// for (var a = 0; a < 256; a++) {
//   for (var b = 0; b < 256; b++) {
//     assertEquals(
//       ReedSolomon.Galois.add(a, b),
//       ReedSolomon.Galois.add(b, a),
//       'Galois',
//       'commutativity',
//       8192
//     );
//     assertEquals(
//       ReedSolomon.Galois.multiply(a, b),
//       ReedSolomon.Galois.multiply(b, a),
//       'Galois',
//       'commutativity',
//       8192
//     );
//   }
// }
//
// // Test distributivity:
// for (var a = 0; a < 256; a++) {
//   for (var b = 0; b < 256; b++) {
//     for (var c = 0; c < 256; c++) {
//       assertEquals(
//         ReedSolomon.Galois.multiply(a, ReedSolomon.Galois.add(b, c)),
//         ReedSolomon.Galois.add(
//           ReedSolomon.Galois.multiply(a, b),
//           ReedSolomon.Galois.multiply(a, c)
//         ),
//         'Galois',
//         'distributivity',
//         2000000
//       );
//     }
//   }
// }
//
// // Test exp:
// for (var a = 0; a < 256; a++) {
//   var power = 1;
//   for (var j = 0; j < 256; j++) {
//     assertEquals(
//       power,
//       ReedSolomon.Galois.exp(a, j),
//       'Galois',
//       'exp',
//       4000
//     );
//     power = ReedSolomon.Galois.multiply(power, a);
//   }
// }
//
// // Test log table generation:
// var logTable = ReedSolomon.Galois.generateLogTable(
//   ReedSolomon.Galois.GENERATING_POLYNOMIAL
// );
// assertArrayEquals(
//   ReedSolomon.Galois.LOG_TABLE,
//   logTable,
//   'Galois',
//   'log table'
// );
//
// // Test exp table generation:
// var expTable = ReedSolomon.Galois.generateExpTable(logTable);
// assertArrayEquals(
//   ReedSolomon.Galois.EXP_TABLE,
//   expTable,
//   'Galois',
//   'exp table'
// );
//
// // Test multiply table:
// var table = ReedSolomon.Galois.TABLE;
// for (var a = 0; a < 256; a++) {
//   for (var b = 0; b < 256; b++) {
//     assertEquals(
//       ReedSolomon.Galois.multiply(a, b),
//       table[(a * 256) + b],
//       'Galois',
//       'table',
//       4000
//     );
//   }
// }

// Test reference values:
Test.equal(12, ReedSolomon.Galois.multiply(3, 4), 'Galois', 'multiply(3, 4)');
Test.equal(21, ReedSolomon.Galois.multiply(7, 7), 'Galois', 'multiply(7, 7)');
Test.equal(
  41,
  ReedSolomon.Galois.multiply(23, 45),
  'Galois',
  'multiply(23, 45)'
);
Test.equal(4, ReedSolomon.Galois.exp(2, 2), 'Galois', 'exp(2, 2)');
Test.equal(235, ReedSolomon.Galois.exp(5, 20), 'Galois', 'exp(5, 20)');
Test.equal(43, ReedSolomon.Galois.exp(13, 7), 'Galois', 'exp(13, 7)');

var random = Math.random.bind(Math);

var sliceShard = function(buffer, bufferOffset, shardIndex, shardLength) {
  var shardOffset = shardIndex * shardLength;
  return buffer.slice(
    bufferOffset + shardOffset,
    bufferOffset + shardOffset + shardLength
  );
};

var corruptShard = function(
  buffer,
  bufferOffset,
  shardIndex,
  shardLength,
  shardOffset,
  shardSize
) {
  var shard = sliceShard(buffer, bufferOffset, shardIndex, shardLength);
  var seen = {};
  var times = Math.min(
    shardSize,
    Math.max(
      1,
      Math.round(random() * Math.min(10, shardSize))
    )
  );
  while (times) {
    var position = Math.min(shardSize - 1, Math.round(random() * shardSize));
    if (seen.hasOwnProperty(position)) continue;
    var source = shard[shardOffset + position];
    var target = (source + Math.floor(random() * 256)) & 255;
    if (target !== source) {
      shard[shardOffset + position] = target;
      seen[position] = true;
      times--;
    }
  }
};

var generateShard = function(shardLength) {
  return Buffer.alloc(shardLength, Math.floor(random() * 256));
};

var hashShard = function(buffer, bufferOffset, shardIndex, shardLength) {
  var hash = Node.crypto.createHash('SHA256');
  hash.update(sliceShard(buffer, bufferOffset, shardIndex, shardLength));
  return hash.digest('hex').slice(0, 128 / 8 * 2); // Truncate hash to 128 bits.
};

var reinstantiateInstance = function(rs, dataShards, parityShards, binding) {
  if (random() < 0.8) return rs;
  Test.equal(true, true, 'ReedSolomon', 'reinstantiated instance');
  return new ReedSolomon(dataShards, parityShards, binding);
};

var fuzz = function(binding, parameters, end) {
  var minShards = 1;
  var minShardLength = 0;
  if (binding === ReedSolomon.binding.native) {
    var bindingType = 'Native';
  } else {
    var bindingType = 'Javascript';
  }
  Test.equal(bindingType, bindingType, 'ReedSolomon', 'binding');
  // Generate Reed Solomon parameters:
  var totalShards = Math.max(
    minShards + 1,
    Math.round(random() * parameters.maxShards)
  );
  var dataShards = Math.max(
    minShards,
    Math.round(random() * (totalShards - 1))
  );
  var parityShards = totalShards - dataShards;
  Test.equal(
    totalShards <= 256,
    true,
    'ReedSolomon',
    'totalShards=' + totalShards
  );
  Test.equal(
    dataShards >= 1 && dataShards <= 31,
    true,
    'ReedSolomon',
    'dataShards=' + dataShards
  );
  Test.equal(
    parityShards >= 1 && dataShards <= 31,
    true,
    'ReedSolomon',
    'parityShards=' + parityShards
  );
  if (random() < 0.01) {
    var shardLength = minShardLength;
  } else {
    var shardLength = Math.max(
      minShardLength,
      Math.round(random() * parameters.maxShardLength)
    );
  }
  Test.equal(
    shardLength >= minShardLength && shardLength <= parameters.maxShardLength,
    true,
    'ReedSolomon',
    'shardLength=' + shardLength
  );
  if (random() < 0.5) {
    var shardOffset = 0;
  } else {
    var shardOffset = Math.min(
      Math.max(0, shardLength - 1),
      Math.round(random() * shardLength)
    );
  }
  Test.equal(
    !(shardOffset < 0 || shardOffset > shardLength),
    true,
    'ReedSolomon',
    'shardOffset=' + shardOffset
  );
  var remaining = shardLength - shardOffset;
  if (random() < 0.2) {
    var shardSize = remaining;
  } else {
    var shardSize = Math.min(remaining, Math.round(random() * remaining));
  }
  Test.equal(
    !(shardSize < 0 || (shardOffset + shardSize) > shardLength),
    true,
    'ReedSolomon',
    'shardSize=' + shardSize
  );
  // Create data shards, initialize parity shards and hash data shards:
  var bufferOffset = Math.floor(random() * shardLength * 2);
  var bufferSize = totalShards * shardLength;
  var bufferTail = Math.floor(random() * shardLength * 2);
  var buffer = Buffer.alloc(bufferOffset + bufferSize + bufferTail);
  Test.equal(
    true,
    true,
    'ReedSolomon',
    'bufferOffset=' + bufferOffset
  );
  Test.equal(
    true,
    true,
    'ReedSolomon',
    'bufferSize=' + bufferSize
  );
  var hashes = new Array(totalShards);
  for (var index = 0; index < dataShards; index++) {
     // Data shard:
    var shard = generateShard(shardLength);
    shard.copy(buffer, bufferOffset + (index * shardLength));
    hashes[index] = hashShard(buffer, bufferOffset, index, shardLength);
  }
  for (var index = dataShards; index < totalShards; index++) {
     // Parity shard:
    var shard = generateShard(shardLength);
    shard.copy(buffer, bufferOffset + (index * shardLength));
  }
  var rs = new ReedSolomon(dataShards, parityShards, binding);
  // Encode parity shards:
  rs.encode(
    buffer,
    bufferOffset,
    bufferSize,
    shardLength,
    shardOffset,
    shardSize,
    function(error) {
      if (error) return end(error);
      // Check that shards were not corrupted by encode():
      for (var index = 0; index < dataShards; index++) {
        Test.equal(
          hashShard(buffer, bufferOffset, index, shardLength),
          hashes[index],
          'ReedSolomon',
          'shard ' + (index + 1) + '/' + totalShards + ' after encoding'
        );
      }
      // Capture parity hashes:
      for (var index = dataShards; index < totalShards; index++) {
        hashes[index] = hashShard(buffer, bufferOffset, index, shardLength);
        Test.equal(
          hashes[index],
          hashes[index],
          'ReedSolomon',
          'shard ' + (index + 1) + '/' + totalShards + ' after encoding'
        );
      }
      // Check parity shards:
      Test.equal(
        CheckParity(
          dataShards,
          parityShards,
          buffer,
          bufferOffset,
          bufferSize,
          shardLength,
          shardOffset,
          shardSize
        ),
        true,
        'ReedSolomon',
        'parity correct'
      );
      // Check that shards were not corrupted by checking parity:
      for (var index = 0; index < totalShards; index++) {
        Test.equal(
          hashShard(buffer, bufferOffset, index, shardLength),
          hashes[index],
          'ReedSolomon',
          'shard ' + (index + 1) + '/' + totalShards + ' after checking parity'
        );
      }
      // Occasionally switch to a new instance:
      rs = reinstantiateInstance(rs, dataShards, parityShards, binding);
      // Decide how many shards to corrupt:
      if (shardSize === 0) {
        var corruptShardsCount = 0;
      } else {
        var corruptShardsCount = Math.round(random() * parityShards);
      }
      Test.equal(
        corruptShardsCount >= 0 && corruptShardsCount <= parityShards,
        true,
        'ReedSolomon',
        'corruptShardsCount=' + corruptShardsCount
      );
      // Choose these shards randomly from data and parity shards:
      var corruptShards = new Array(totalShards);
      for (var index = 0; index < totalShards; index++) {
        corruptShards[index] = index;
      }
      var order = {};
      corruptShards.sort(
        function(a, b) {
          var key = a < b ? (a + '.' + b) : (b + '.' + a);
          if (!order.hasOwnProperty(key)) {
            order[key] = random() < 0.5 ? -1 : 1;
          }
          return order[key];
        }
      );
      var corrupt = {};
      for (var index = 0; index < corruptShardsCount; index++) {
        corrupt[corruptShards[index]] = true;
      }
      // Corrupt shards and update targets:
      var targets = 0;
      for (var index = 0; index < totalShards; index++) {
        if (corrupt.hasOwnProperty(index)) {
          targets |= (1 << index);
          corruptShard(
            buffer,
            bufferOffset,
            index,
            shardLength,
            shardOffset,
            shardSize
          );
        }
      }
      // Occasionally switch to a new instance:
      rs = reinstantiateInstance(rs, dataShards, parityShards, binding);
      // Check parity shards (should now be false):
      Test.equal(
        CheckParity(
          dataShards,
          parityShards,
          buffer,
          bufferOffset,
          bufferSize,
          shardLength,
          shardOffset,
          shardSize
        ),
        corruptShardsCount === 0,
        'ReedSolomon',
        'parity correct'
      );
      // Decode corrupted shards:
      rs.decode(
        buffer,
        bufferOffset,
        bufferSize,
        shardLength,
        shardOffset,
        shardSize,
        targets,
        function(error) {
          if (error) return end(error);
          // Check that shards are all correct:
          for (var index = 0; index < totalShards; index++) {
            Test.equal(
              hashShard(buffer, bufferOffset, index, shardLength),
              hashes[index],
              'ReedSolomon',
              'shard ' + (index + 1) + '/' + totalShards + ' after decoding'
            );
          }
          end();
        }
      );
    }
  );
};

var bindings = [ReedSolomon.binding.javascript];
var bindingNames = ['Javascript'];

if (ReedSolomon.binding.native) {
  bindings.push(ReedSolomon.binding.native);
  bindingNames.push('Native');
}
var queue = new QueueStream();
queue.onData = function(binding, end) {
  var queue = new QueueStream();
  queue.onData = function(parameters, end) {
    fuzz(binding, parameters, end);
  };
  queue.onEnd = function(error) {
    if (error) return end(error);
    // Fixed vector test:
    Test.equal(
      true,
      true,
      'ReedSolomon',
      'fixed vector'
    );
    var dataShards = 5;
    var parityShards = 5;
    var rs = new ReedSolomon(dataShards, parityShards, binding);
    var buffer = Buffer.concat([
      Buffer.from([0, 1]),
      Buffer.from([4, 5]),
      Buffer.from([2, 3]),
      Buffer.from([6, 7]),
      Buffer.from([8, 9]),
      Buffer.from([0, 0]),
      Buffer.from([0, 0]),
      Buffer.from([0, 0]),
      Buffer.from([0, 0]),
      Buffer.from([0, 0])
    ]);
    var bufferOffset = 0;
    var bufferSize = buffer.length;
    var shardLength = 2;
    var shardOffset = 0;
    var shardSize = shardLength;
    rs.encode(
      buffer,
      bufferOffset,
      bufferSize,
      shardLength,
      shardOffset,
      shardSize,
      function(error) {
        if (error) return end(error);
        function shard(index) {
          var offset = index * 2;
          return buffer.slice(offset, offset + 2);
        }
        Test.equal(shard(0), Buffer.from([0, 1]), 'ReedSolomon', 'shard 0');
        Test.equal(shard(1), Buffer.from([4, 5]), 'ReedSolomon', 'shard 1');
        Test.equal(shard(2), Buffer.from([2, 3]), 'ReedSolomon', 'shard 2');
        Test.equal(shard(3), Buffer.from([6, 7]), 'ReedSolomon', 'shard 3');
        Test.equal(shard(4), Buffer.from([8, 9]), 'ReedSolomon', 'shard 4');
        Test.equal(shard(5), Buffer.from([12, 13]), 'ReedSolomon', 'shard 5');
        Test.equal(shard(6), Buffer.from([10, 11]), 'ReedSolomon', 'shard 6');
        Test.equal(shard(7), Buffer.from([14, 15]), 'ReedSolomon', 'shard 7');
        Test.equal(shard(8), Buffer.from([90, 91]), 'ReedSolomon', 'shard 8');
        Test.equal(shard(9), Buffer.from([94, 95]), 'ReedSolomon', 'shard 9');
        Test.equal(
          CheckParity(
            dataShards,
            parityShards,
            buffer,
            bufferOffset,
            bufferSize,
            shardLength,
            shardOffset,
            shardSize
          ),
          true,
          'ReedSolomon',
          'fixed vector parity correct'
        );
        buffer[0] = 255;
        Test.equal(
          CheckParity(
            dataShards,
            parityShards,
            buffer,
            bufferOffset,
            bufferSize,
            shardLength,
            shardOffset,
            shardSize
          ),
          false,
          'ReedSolomon',
          'fixed vector parity correct'
        );
        end();
      }
    );
  };
  // Do many small tests:
  var tests = 1000;
  while (tests--) queue.push({ maxShards: 31, maxShardLength: 32 });
  // Do some large tests:
  var tests = 100;
  while (tests--) queue.push({ maxShards: 31, maxShardLength: 256 * 1024 });
  queue.end();
};
queue.onEnd = function(error) {
  if (error) throw error;
  console.log('Bindings Tested: ' + bindingNames.join(', '));
  console.log('================');
  console.log('ALL TESTS PASSED');
  console.log('================');
};
queue.push(bindings);
queue.end();
