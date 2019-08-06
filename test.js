var assert = require('assert');

var Node = { crypto: require('crypto') };
var Queue = require('@ronomon/queue');
var ReedSolomon = require('./binding.node');

function Args(options) {
  var w = options.w === undefined ? 4 : options.w;
  var k = options.k === undefined ? 3 : options.k;
  var m = options.m === undefined ? 2 : options.m;
  var create = false;
  [
    'sources',
    'targets',
    'buffer',
    'bufferOffset',
    'bufferSize',
    'parity',
    'parityOffset',
    'paritySize'
  ].forEach(
    function(key) {
      if (options.hasOwnProperty(key)) create = true;
    }
  );
  if (options.context) {
    var context = options.context;
  } else if (create) {
    var context = ReedSolomon.create(k, m);
    assert(Buffer.isBuffer(context));
  } else {
    var context = Buffer.alloc(3 + k * w * m * w);
    context[0] = w;
    context[1] = k;
    context[2] = m;
  }
  var sources = options.sources;
  if (sources === undefined) {
    sources = 0;
    for (var i = 0; i < k; i++) sources |= (1 << i);
  }
  var targets = options.targets;
  if (targets === undefined) {
    targets = 0;
    for (var i = k; i < k + m; i++) targets |= (1 << i);
  }
  var bufferOffset = options.bufferOffset;
  if (bufferOffset === undefined) bufferOffset = 0;
  var bufferSize = options.bufferSize;
  if (bufferSize === undefined) bufferSize = 8 * k;
  var parityOffset = options.parityOffset;
  if (parityOffset === undefined) parityOffset = 0;
  var paritySize = options.paritySize;
  if (paritySize === undefined) paritySize = 8 * m;
  var buffer = options.buffer;
  if (buffer === undefined) buffer = Buffer.alloc(bufferOffset + bufferSize);
  var parity = options.parity;
  if (parity === undefined) parity = Buffer.alloc(parityOffset + paritySize);
  return [
    context,
    sources,
    targets,
    buffer,
    bufferOffset,
    bufferSize,
    parity,
    parityOffset,
    paritySize,
    function() {}
  ];
}

var BadArgs = {
  create: 'bad arguments, expected: (int k, int m)',
  encode: 'bad arguments, expected: (Buffer context, int sources, ' +
          'int targets, Buffer buffer, int bufferOffset, int bufferSize, ' +
          'Buffer parity, int parityOffset, int paritySize, function end)',
  XOR:    'bad arguments, expected: (Buffer source, int sourceOffset, ' +
          'Buffer target, int targetOffset, int size)'
};

function Bits(flags) {
  var bits = 0;
  while (flags > 0) {
    if (flags & 1) bits++;
    flags >>= 1;
  }
  return bits;
}

function Hash(buffer) {
  var hash = Node.crypto.createHash('SHA256').update(buffer).digest('hex');
  return hash.slice(0, 32);
}

function Inspect(args, buffer, parity) {
  var self = Inspect;
  console.log(new Array(50).join('-'));
  var k = args[0];
  var m = args[1];
  var bufferOffset = args[2];
  var parityOffset = args[3];
  var shardSize = args[4];
  for (var i = 0; i < k + m; i++) {
    if (i === 0) {
      var offset = self.offset(buffer, bufferOffset);
      if (offset) console.log(offset);
    } else if (i === k) {
      var offset = self.offset(parity, parityOffset);
      if (offset) console.log(offset);
    }
    var prefix = (i + (i < k ? ' (K)' : ' (M)') + ': ').padStart(8, ' ');
    var suffix = ' (' + shardSize + ')';
    if (i < k) {
      var shard = buffer.slice(
        bufferOffset + i * shardSize,
        bufferOffset + i * shardSize + shardSize
      );
    } else {
      var shard = parity.slice(
        parityOffset + (i - k) * shardSize,
        parityOffset + (i - k) * shardSize + shardSize
      );
    }
    console.log(prefix + self.shard(shard) + suffix);
  }
}

Inspect.offset = function(buffer, offset) {
  var self = Inspect;
  if (offset > 0) {
    var prefix = '        ';
    var suffix = ' (' + offset + ')';
    return prefix + self.shard(buffer.slice(0, offset)) + suffix;
  }
  return '';
};

Inspect.shard = function(shard) {
  var match = true;
  for (var index = 1, length = shard.length; index < length; index++) {
    if (shard[index] != shard[index - 1]) {
      match = false;
      break;
    }
  }
  if (match) {
    if (shard[0] === 0) return new Array(32 + 1).join('0');
    if (shard[0] === 255) return new Array(32 + 1).join('f');
  }
  return Hash(shard);
};

function Random() {
  var self = Random;
  if (self.hash === undefined) self.hash = 1;
  self.hash = ((self.hash + 0x7ED55D16) + (self.hash << 12)) & 0xFFFFFFF;
  self.hash = ((self.hash ^ 0xC761C23C) ^ (self.hash >>> 19)) & 0xFFFFFFF;
  self.hash = ((self.hash + 0x165667B1) + (self.hash << 5)) & 0xFFFFFFF;
  self.hash = ((self.hash + 0xD3A2646C) ^ (self.hash << 9)) & 0xFFFFFFF;
  self.hash = ((self.hash + 0xFD7046C5) + (self.hash << 3)) & 0xFFFFFFF;
  self.hash = ((self.hash ^ 0xB55A4F09) ^ (self.hash >>> 16)) & 0xFFFFFFF;
  return (self.hash & 0xFFFFFFF) / 0x10000000;
}

function Shuffle(array) {
  for (var i = array.length - 1; i > 0; i--) {
    var j = Math.floor(Random() * (i + 1));
    var temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
}

function Slice(buffer, bufferOffset, shardSize, shardIndex) {
  return buffer.slice(
    bufferOffset + shardSize * shardIndex,
    bufferOffset + shardSize * shardIndex + shardSize
  );
}

function XOR(sources) {
  var target = Buffer.alloc(sources[0].length);
  var sourcesLength = sources.length;
  while (sourcesLength--) {
    var source = sources[sourcesLength];
    for (var index = 0, length = source.length; index < length; index++) {
      target[index] ^= source[index];
    }
  }
  return target;
}

var namespace = 'ReedSolomon';

var B0 = Buffer.alloc(0);
var B1 = Buffer.alloc(1);
var B8 = Buffer.alloc(8);
var B16 = Buffer.alloc(16);

[
  [ 'create', [], BadArgs.create ],
  [ 'create', [1, 2, 3], BadArgs.create ],
  [ 'create', ['1', '2'], BadArgs.create ],
  [ 'create', [1.001, 2], BadArgs.create ],
  [ 'create', [2, 1.001], BadArgs.create ],
  [ 'create', [undefined, 1], BadArgs.create ],
  [ 'create', [1 / 0, 1], BadArgs.create ],
  [ 'create', [0, 1], 'k < 1' ],
  [ 'create', [ReedSolomon.MAX_K + 1, 1], 'k > MAX_K' ],
  [ 'create', [1, 0], 'm < 1' ],
  [ 'create', [1, ReedSolomon.MAX_M + 1], 'm > MAX_M' ],
  [ 'encode', [], BadArgs.encode ],
  [ 'encode', Args({ context: B1 }), 'context.length < 3' ],
  [
    'encode',
    Args({ context: Buffer.from([2,1,1]) }),
    'context.length is bad'
  ],
  [
    'encode',
    Args({ context: Buffer.from([2,1,1,1,1,1,1]) }),
    'bitmatrix not optimized'
  ],
  [ 'encode', Args({ w: 0 }), 'w != 2, 4, 8' ],
  [ 'encode', Args({ w: 1 }), 'w != 2, 4, 8' ],
  [ 'encode', Args({ w: 3 }), 'w != 2, 4, 8' ],
  [ 'encode', Args({ w: 5 }), 'w != 2, 4, 8' ],
  [ 'encode', Args({ w: 6 }), 'w != 2, 4, 8' ],
  [ 'encode', Args({ w: 7 }), 'w != 2, 4, 8' ],
  [ 'encode', Args({ w: 9 }), 'w != 2, 4, 8' ],
  [ 'encode', Args({ k: 0 }), 'k < 1' ],
  [ 'encode', Args({ k: ReedSolomon.MAX_K + 1 }), 'k > MAX_K' ],
  [ 'encode', Args({ m: 0 }), 'm < 1' ],
  [ 'encode', Args({ m: ReedSolomon.MAX_M + 1 }), 'm > MAX_M' ],
  [ 'encode', Args({ w: 2, k: 3, m: 2 }), 'k + m > (1 << w)' ],
  [ 'encode', Args({ w: 4, k: 13, m: 4 }), 'k + m > (1 << w)' ],
  [ 'encode', Args({ k: 1, m: 1, sources: 4 }), 'sources > k + m' ],
  [ 'encode', Args({ k: 1, m: 1, sources: 0 }), 'sources == 0' ],
  [ 'encode', Args({ k: 2, m: 1, sources: 1 }), 'sources < k' ],
  [ 'encode', Args({ k: 1, m: 1, targets: 4 }), 'targets > k + m' ],
  [ 'encode', Args({ k: 1, m: 1, targets: 0 }), 'targets == 0' ],
  [ 'encode', Args({ k: 1, m: 1, targets: 3 }), 'targets > m' ],
  [ 'encode', Args({ targets: 1 }), '(sources & targets) != 0' ],
  [ 'encode', Args({ bufferSize: 0 }), 'bufferSize == 0' ],
  [
    'encode',
    Args({ bufferOffset: 4294967296, bufferSize: 8, buffer: B8 }),
    BadArgs.encode
  ],
  [
    'encode',
    Args({ bufferOffset: 0, bufferSize: 4294967296, buffer: B8 }),
    BadArgs.encode
  ],
  [
    'encode',
    Args({ bufferOffset: 1, bufferSize: 8, buffer: B8 }),
    'bufferOffset + bufferSize > buffer.length'
  ],
  [
    'encode',
    Args({ bufferOffset: 4294967295, bufferSize: 8, buffer: B8 }),
    'bufferOffset + bufferSize > buffer.length'
  ],
  [ 'encode', Args({ bufferSize: 16 }), 'bufferSize % k != 0' ],
  [ 'encode', Args({ bufferSize: 30 }), 'shardSize % w != 0' ],
  [ 'encode', Args({ bufferSize: 12 }), 'shardSize % 8 != 0' ],
  [ 'encode', Args({ paritySize: 0 }), 'paritySize == 0' ],
  [ 'encode', Args({ paritySize: 7 }), 'paritySize % m != 0' ],
  [ 'encode', Args({ paritySize: 8 }), 'paritySize / m != bufferSize / k' ],
  [
    'encode',
    Args({ parityOffset: 4294967296, paritySize: 16, parity: B16 }),
    BadArgs.encode
  ],
  [
    'encode',
    Args({ parityOffset: 0, paritySize: 4294967296, parity: B16 }),
    BadArgs.encode
  ],
  [
    'encode',
    Args({ parityOffset: 1, paritySize: 16, parity: B16 }),
    'parityOffset + paritySize > parity.length'
  ],
  [
    'encode',
    Args({ parityOffset: 4294967295, paritySize: 16, parity: B16 }),
    'parityOffset + paritySize > parity.length'
  ],
  [ 'search', [undefined], 'expected no arguments' ],
  [ 'XOR', [], BadArgs.XOR ],
  [ 'XOR', [null, 0, null, 0, 0], BadArgs.XOR ],
  [ 'XOR', [B1, 0, B1, 0, -1], BadArgs.XOR ],
  [ 'XOR', [B1, 4294967296, B1, 0, 1], BadArgs.XOR ],
  [ 'XOR', [B1, 0, B1, 4294967296, 1], BadArgs.XOR ],
  [ 'XOR', [B1, 0, B1, 0, 4294967296], BadArgs.XOR ],
  [ 'XOR', [B0, 1, B0, 0, 0], 'sourceOffset + size > source.length' ],
  [ 'XOR', [B0, 0, B1, 0, 1], 'sourceOffset + size > source.length' ],
  [ 'XOR', [B1, 4294967295, B1, 0, 1], 'sourceOffset + size > source.length' ],
  [ 'XOR', [B0, 0, B0, 1, 0], 'targetOffset + size > target.length' ],
  [ 'XOR', [B1, 0, B0, 0, 1], 'targetOffset + size > target.length' ],
  [ 'XOR', [B1, 0, B1, 4294967295, 1], 'targetOffset + size > target.length' ]
].forEach(
  function(exception) {
    var error;
    try {
      ReedSolomon[exception[0]](...exception[1]);
    } catch (e) {
      error = e.message;
    }
    if (error !== exception[2]) {
      throw new Error(
        JSON.stringify(error) + ' !== ' + JSON.stringify(exception[2])
      );
    }
  }
);

(function() {
  var xors = 100;
  while (xors--) {
    if (Random() < 0.6) {
      var size = Math.floor(Random() * 65536);
    } else {
      var size = Math.floor(Random() * 8);
    }
    var sourceOffset = Math.floor(Random() * 16);
    var targetOffset = Math.floor(Random() * 16);
    var cipher = Node.crypto.createCipheriv(
      'AES-256-CTR',
      Buffer.alloc(32),
      Buffer.alloc(16)
    );
    var buffer = cipher.update(
      Buffer.alloc(sourceOffset + size + targetOffset + size)
    );
    cipher.final();
    var source = buffer;
    var target = buffer;
    targetOffset += sourceOffset;
    targetOffset += size;
    var expect = Buffer.from(buffer);
    for (var index = 0; index < size; index++) {
      expect[targetOffset + index] ^= source[sourceOffset + index];
    }
    ReedSolomon.XOR(source, sourceOffset, target, targetOffset, size);
    assert(Hash(target) === Hash(expect));
  }
})();

var queue = new Queue(1);
queue.onData = function(args, end) {
  // Use this to regenerate the fixed test vectors:
  var regenerate = false;
  var k = args[0];
  var m = args[1];
  var bufferOffset = args[2];
  var parityOffset = args[3];
  var shardSize = args[4];
  var vector = args[5];
  var context = ReedSolomon.create(k, m);
  var w = context[0];
  console.log(new Array(50).join('='));
  console.log('        W=' + w + ' K=' + k + ' M=' + m);
  assert(w == 2 || w == 4 || w == 8);
  assert(k + m <= (1 << w));
  assert(context.length === 3 + k * w * m * w);
  var bufferSize = shardSize * k;
  var paritySize = shardSize * m;
  var seed = Node.crypto.createHash('SHA256');
  seed.update([k, m, bufferOffset, parityOffset, shardSize].join(','));
  var cipher = Node.crypto.createCipheriv(
    'AES-256-CTR',
    seed = seed.digest(),
    Buffer.alloc(16)
  );
  var buffer = cipher.update(Buffer.alloc(bufferOffset + bufferSize));
  assert(buffer.length === bufferOffset + bufferSize);
  var parity = cipher.update(Buffer.alloc(parityOffset + paritySize));
  if (parityOffset) {
    assert(
      cipher.update(Buffer.alloc(parityOffset)).copy(parity, 0) === parityOffset
    );
  }
  cipher.final(); // Free cipher.
  var hashContext = Hash(context);
  var hashBuffer = Hash(buffer.slice(0, bufferOffset));
  var hashParity = Hash(parity.slice(0, parityOffset));
  var shards = [];
  var hashes = [];
  var sources = 0;
  var targets = 0;
  for (var i = 0; i < k; i++) {
    shards[i] = Slice(buffer, bufferOffset, shardSize, i);
    hashes[i] = Hash(shards[i]);
    sources |= (1 << i);
  }
  for (var i = k; i < k + m; i++) {
    shards[i] = Slice(parity, parityOffset, shardSize, i - k);
    targets |= (1 << i);
  }
  Inspect(args, buffer, parity);
  ReedSolomon.encode(
    context,
    sources,
    targets,
    buffer,
    bufferOffset,
    bufferSize,
    parity,
    parityOffset,
    paritySize,
    function(error) {
      if (error) return end(error);
      Inspect(args, buffer, parity);
      assert(Hash(context) == hashContext);
      assert(Hash(buffer.slice(0, bufferOffset)) == hashBuffer);
      assert(Hash(parity.slice(0, parityOffset)) == hashParity);
      for (var i = 0; i < k; i++) assert(Hash(shards[i]) === hashes[i]);
      for (var i = k; i < k + m; i++) hashes[i] = Hash(shards[i]);
      // Test against fixed vector:
      var result = Hash(hashes.join(','));
      if (regenerate) {
        console.log('  [' +
          [
            k.toString().padStart(2, ' '),
            m,
            bufferOffset.toString().padStart(2, ' '),
            parityOffset.toString().padStart(2, ' '),
            shardSize.toString().padStart(6, ' '),
            "'" + result + "'"
          ].join(', ') + ']' +
          (
            (
              k == ReedSolomon.MAX_K &&
              m == ReedSolomon.MAX_M &&
              shardSize > 8
            ) ? '' : ','
          )
        );
      } else {
        assert(result === vector);
      }

      // First parity shard must always be an XOR of all data shards:
      assert(Hash(XOR(shards.slice(0, k))) === hashes[k]);
      if (k === 1) {
        // All shards must be identical when k=1:
        for (var i = 1; i < k + m; i++) assert(hashes[i] === hashes[0]);
      }
      // Choose source and target shards:
      var sources = 0;  
      var targets = 0;
      var voided = [];
      var indices = [];
      for (var i = 0; i < k + m; i++) indices.push(i);
      Shuffle(indices);
      var targetsIndex = 0;
      var targetsLength = Math.ceil(Random() * m);
      while (targetsIndex < targetsLength) {
        targets |= (1 << indices[targetsIndex++]);
      }
      var sourcesIndex = 0;
      var sourcesLength = k + Math.floor(Random() * (m - targetsLength));
      while (sourcesIndex < sourcesLength) {
        sources |= (1 << indices[targetsLength + sourcesIndex++]);
      }
      assert((sources & targets) == 0);
      assert(Bits(sources) >= k && Bits(sources) <= k + m);
      assert(Bits(targets) >= 1 && Bits(targets) <= m);
      for (var i = 0; i < k + m; i++) {
        voided[i] = undefined;
        if (targets & (1 << i)) {
          shards[i].fill(0);
        } else if ((sources & (1 << i)) == 0 && Random() < 0.5) {
          shards[i].fill(255);
          voided[i] = Hash(shards[i]);
        }
      }
      Inspect(args, buffer, parity);
      ReedSolomon.encode(
        context,
        sources,
        targets,
        buffer,
        bufferOffset,
        bufferSize,
        parity,
        parityOffset,
        paritySize,
        function(error) {
          if (error) return end(error);
          Inspect(args, buffer, parity, sources, targets);
          assert(Hash(context) === hashContext);
          assert(Hash(buffer.slice(0, bufferOffset)) === hashBuffer);
          assert(Hash(parity.slice(0, parityOffset)) === hashParity);
          var strictVoided = (
            k === 1 ||
            (
              Bits(targets) === 1 &&
              Bits(sources % (1 << (k + 1))) === k &&
              Bits(targets % (1 << (k + 1))) === 1
            )
          );
          for (var i = 0; i < k + m; i++) {
            var hashShard = Hash(shards[i]);
            if (voided[i]) {
              // Shard was neither a source nor target.
              if (strictVoided) {
                // We expect an optimization to avoid the shard:
                assert(hashShard === voided[i]);
              } else {
                // We are free to repair the shard if needed for other shards:
                assert(hashShard === hashes[i] || hashShard === voided[i]);
              }
            } else {
              assert(hashShard === hashes[i]);
            }
          }
          end();
        }
      );
    }
  );
};
queue.onEnd = function(error) {
  if (error) throw error;
  console.log(new Array(50).join('='));
  console.log('        PASSED');
  console.log(new Array(50).join('='));
};
assert(typeof ReedSolomon.search === 'function');
assert(ReedSolomon.MAX_K === 24);
assert(ReedSolomon.MAX_M === 6);
queue.concat([
  [ 1, 1,  3,  2,      8, '8f2f6338f7f86123959816e8fbb3ce1f'],
  [ 1, 1,  4,  2,  77856, '47b8befeab9ff4548d46121e3fd311e4'],
  [ 1, 2, 11,  3,      8, '1fa2a2bc51a887746a9f7dc69a29cbb2'],
  [ 1, 2,  0, 13, 217840, '43549bf420c1bd77893663eb3371a085'],
  [ 1, 3,  8,  1,      8, '0dc8f67f13b2e6380104e5ada1d233ce'],
  [ 1, 3,  8, 11, 206528, '12092146e2a5c8f11a4ac759247a4e8b'],
  [ 1, 4, 15, 13,      8, '082b81d7bc913f907280fcfa4579fb5c'],
  [ 1, 4,  4, 11, 201528, 'c0ebbde41e413580c97d28d55e2aab4e'],
  [ 1, 5,  2, 12,      8, '729b3f1931d1f07e80650deff1c23ce5'],
  [ 1, 5,  1, 11,  75128, '1e425618dcdb194067f58bfa4ebdce9f'],
  [ 1, 6,  6,  4,      8, '8dd97aeb6b46b77000561477b90f1a43'],
  [ 1, 6,  4,  5, 258144, '7e78c7b99df20a8e0e40a00a1de90b34'],
  [ 2, 1,  4, 12,      8, '4d4835bb6a337283fc164fe11f2f84bc'],
  [ 2, 1,  0, 13, 128864, '4bfb334fc675aa2024ac1497645f38cc'],
  [ 2, 2, 12,  2,      8, 'a682beb83c43fc40f600f9ee1906c8d2'],
  [ 2, 2, 11,  3, 213528, '84d767ff54f2ca67edea4f63be828140'],
  [ 2, 3,  8, 14,      8, 'd2a21c6f6afc715dd9ee4628d3ba038a'],
  [ 2, 3,  4,  2, 117448, '7d365f2f9231e8310776fa6529200e27'],
  [ 2, 4,  4, 10,      8, '6032933d617d875530a5c584b39b3b52'],
  [ 2, 4,  9, 15, 228168, 'fdb0527b81e8cb1c5320fe8b31e53cc8'],
  [ 2, 5,  9,  6,      8, '597d248d1ec32aa237e80d8f6e7d2873'],
  [ 2, 5,  0, 14, 129032, 'd138d700195c0fa765dbaa937a884f87'],
  [ 2, 6, 12, 12,      8, '77309990546426fc6794dbff3549f579'],
  [ 2, 6,  3,  4, 108888, '5864a7af80772917108042c6b039e42f'],
  [ 3, 1,  5,  9,      8, '81d0059cfcd0303dbd944220e76f3187'],
  [ 3, 1,  0, 15, 254320, '9388f521ad51f8301bd34c11d7b2b0d6'],
  [ 3, 2,  3, 12,      8, '21bb16aa96305d1e6d63ac1cfb524b71'],
  [ 3, 2, 14,  0, 123136, 'a205985140347e7b75a668516ab9e695'],
  [ 3, 3,  6,  9,      8, '02c0985420b4b21d10a2cf87e8cb288f'],
  [ 3, 3,  6,  9,  34488, 'a55516606faccb6f5d08b5219b263ab4'],
  [ 3, 4, 12,  6,      8, 'bf581ff28c5d94255211a78f96b38a6c'],
  [ 3, 4,  5,  3, 162040, '356c2ee083f931cf375fbbd1eb3de294'],
  [ 3, 5, 11, 13,      8, '3363d49814998e74952fa970aafc737e'],
  [ 3, 5,  5,  9,  57904, 'b58b87f1ce5f8c78399bb774cbe15bc6'],
  [ 3, 6, 13,  0,      8, 'a306881dfd5f1d7a0275c11fd0b385eb'],
  [ 3, 6,  7, 11,  71200, '3628820c2ba756a0422fdcf81d7ba5ad'],
  [ 4, 1,  8,  8,      8, 'b880b7cc70a430d28163ce2e9c47c9fd'],
  [ 4, 1,  2,  9, 199648, 'a42df9841cf12b7317866436f5250110'],
  [ 4, 2,  5,  1,      8, 'b817e4953b2e69fcd89fdd431b81d8d6'],
  [ 4, 2,  4,  8,  84816, '2f2c7e6f50f7a8ffb99ae4b9b1682896'],
  [ 4, 3,  7,  8,      8, '9280ccf9421e96d01a4e2da3b6e16764'],
  [ 4, 3, 10,  0, 158184, 'd6667e932a2549a3b62161a79e990205'],
  [ 4, 4,  2,  9,      8, 'bdea43c206917dd16ae61a45b71ab021'],
  [ 4, 4,  1,  2, 255704, '77c53b5724f4839043c41bad2a54c806'],
  [ 4, 5, 12,  6,      8, '678df1e0eb2317be96af5492de1ab594'],
  [ 4, 5,  4,  8, 109160, 'cd018fc2af02f55d52def647b797c6d1'],
  [ 4, 6,  5,  3,      8, '268cba36dd6fe623a6e058c631de29da'],
  [ 4, 6, 15,  9,  20640, '11d3c5b7328bcca99340465b6bd5c28f'],
  [ 5, 1,  6,  8,      8, '8c19fc188792a7682bf1c927996e808d'],
  [ 5, 1,  4,  6,  33696, '234103bc31ed69cc532687ec7d379ffc'],
  [ 5, 2, 12,  2,      8, '547b4bd53452169f1a032ff7767e27dc'],
  [ 5, 2,  4,  0, 222464, 'cf25d5baaa27fd0369366c05d110621a'],
  [ 5, 3,  5, 10,      8, 'cb3bc8560051466c3e99ac28735a09c1'],
  [ 5, 3, 14,  8, 201616, '11f685cd21d627c6becb3436a3f38ac8'],
  [ 5, 4,  6, 11,      8, '1dcd62393c2a0bbb36325707b424074a'],
  [ 5, 4,  9,  3, 158328, '667b92e9ee1b8c90f63b5d22af4777e8'],
  [ 5, 5, 12,  8,      8, '8e887bcd2c47e5aeb7cb9555abd51974'],
  [ 5, 5,  9,  2, 246456, '2070ae39545ac6219782f339b4328cdb'],
  [ 5, 6,  4,  6,      8, '5b0bdb939ce39bfa45a2b3f8bcf3ab73'],
  [ 5, 6,  0, 12, 140752, 'd37328a72808f4b39bd8d5124d5e46e1'],
  [ 6, 1,  2, 14,      8, 'b6d4ee256dbb2b0c3983d48365b05aee'],
  [ 6, 1,  3,  4, 259664, '842f4cee3895cd5351610643a7dcd477'],
  [ 6, 2,  8,  5,      8, '2ab266a7843a651b6565183727f4b3dc'],
  [ 6, 2,  3,  4, 211216, 'a015106aeeb37e951c076e151c8f0b47'],
  [ 6, 3,  5, 10,      8, '78f42cbe317191fdf6973aa62aa29b03'],
  [ 6, 3, 13,  6,  46472, '706281f04510f6a7b44eb75119ba1fee'],
  [ 6, 4, 11, 14,      8, 'b6ca87806834d540d0e8172c4ea811d5'],
  [ 6, 4,  9,  2, 162048, 'ab7e05bbbd859367de230f22824561b9'],
  [ 6, 5,  2,  5,      8, 'aaf948718ece3e36af12db2927d530df'],
  [ 6, 5,  9, 12, 259376, '3c1215b346e30acfe50deae45c295b39'],
  [ 6, 6,  2, 11,      8, 'f23deb29c6397a656fc64773e9723536'],
  [ 6, 6,  0, 14, 252312, 'ada74fff2ce463c5cd9cdf9ba65855e2'],
  [ 7, 1,  3, 14,      8, 'c639d633efc8f1f2d3da0dc54c67a6e4'],
  [ 7, 1, 14, 15, 112488, '52b6ccef2f7c8f6f5c435ec55ecce94f'],
  [ 7, 2,  4,  5,      8, 'e55ddc42a5cbd8f38e7d691593de7da4'],
  [ 7, 2,  8,  2, 128216, '51300f47646591a32d6c0558f8ea7073'],
  [ 7, 3,  3,  1,      8, '816cee5ffddbfbb6cdebf682e4819de6'],
  [ 7, 3, 10, 11,  83536, '79c1e823274b316aba47519bef446c72'],
  [ 7, 4,  9, 12,      8, 'c0c6166b9d749095e310fefccc2f61cc'],
  [ 7, 4,  3,  5,  15920, 'aa65d39a23a94b2767b1b6e69201f4d1'],
  [ 7, 5, 14,  3,      8, '703f918dbcc005b793840935317b4d2a'],
  [ 7, 5, 10, 15, 255008, '2fac6e471bcaba4b170edf1580e67d98'],
  [ 7, 6, 14,  3,      8, '8e4ee85339bcf4066f9f45e0dc6b3210'],
  [ 7, 6, 10,  9,   8096, '3ead0c0cc1085c42cd4f9d0b38feb978'],
  [ 8, 1,  2, 13,      8, '38697ab421dc43c64fac9a0e833e5d62'],
  [ 8, 1,  2,  9, 217760, '22069802fbcd3e49c588ad08a0e16cb2'],
  [ 8, 2,  2, 13,      8, 'bca46cda037db6001ca93868ea869e97'],
  [ 8, 2,  9,  7, 181320, '69bc6bd2bd362e8f09c49fb82d7ee371'],
  [ 8, 3, 15,  3,      8, '3e192cd7004deb2da5d17051e187e04f'],
  [ 8, 3, 13,  4, 168928, '93197bb51c3a43372742dad1290f26ac'],
  [ 8, 4, 12,  4,      8, '56f1f1196beb6aa01ddde9d424b016d3'],
  [ 8, 4,  3, 11, 227800, '9bc78101484c024c89a7959a1c7cb214'],
  [ 8, 5, 12,  0,      8, 'b239e58d357293e0ef56885ef7d4ca6b'],
  [ 8, 5, 12,  1, 135616, '3d24f48d9ab3fb06d471be24c535f41d'],
  [ 8, 6,  2, 15,      8, '89d3c9c9f9176b4e8f99abfff60f0af9'],
  [ 8, 6,  7,  6,  79672, 'd6b6b662ee56711be67c0ceef9a7b98c'],
  [ 9, 1,  9,  6,      8, '462e5787fd5efcc1573bfec106010b31'],
  [ 9, 1,  5, 11,  71488, '4d6d380922fcd790873abf65ff8f6a50'],
  [ 9, 2, 10, 10,      8, '68416a9be47a4fc052c11ac45a0e7a04'],
  [ 9, 2, 15,  1, 173096, '1d788532d2eb9aca722ad7d8110296b9'],
  [ 9, 3, 10, 13,      8, '38ae8241c553daf9f38c17d16892b406'],
  [ 9, 3, 14,  0, 178192, '8bfa1c9bacc394f66571f1640eec70a8'],
  [ 9, 4,  5,  3,      8, 'a33a3da115298d350461ed264b871188'],
  [ 9, 4,  3, 15, 220120, '9998c110cd9372ff3b28bf86a1190d3e'],
  [ 9, 5,  1,  6,      8, 'f625bfca82e2a1a0dcb61fe4b9077910'],
  [ 9, 5, 15, 11, 149080, 'f02e09b26bd622664ad6344f070b1a1c'],
  [ 9, 6,  6,  4,      8, '7b8659859a9310421cedfc16979e8abe'],
  [ 9, 6,  3,  1, 190064, 'd46e8b3de14902ea04836c1be7abe142'],
  [10, 1,  3, 13,      8, 'a18a04a81303ce3444b61ddb492233f6'],
  [10, 1,  9, 15,  47800, '48506ae505d413bfcad976722e96d426'],
  [10, 2, 11, 12,      8, 'f10ae500f9eb274f070132318400ef1b'],
  [10, 2, 12, 15, 159360, '591ea0defc50529a7add19ebcf744a0f'],
  [10, 3, 10,  5,      8, '61dc803b39a3bb417e46d58f61279203'],
  [10, 3, 13, 12, 248992, '1dd39162588c68e0d30a40d0e45711aa'],
  [10, 4,  7,  3,      8, '3e0212d68950ead260fa854a53b33fc7'],
  [10, 4,  7, 14, 223304, '69e0af8a72a36f6f90c872601331b20c'],
  [10, 5, 12,  0,      8, 'ac445f54594f7ff867aec5cde0ae712c'],
  [10, 5, 12,  7, 144432, '80e22dd16e0b93d1981d1de20d8e97e0'],
  [10, 6, 14, 12,      8, 'a364714d66982b75bbe67ff6513f25aa'],
  [10, 6,  8,  1, 176032, '1fb7e3ba784eae89368d8481b1f62285'],
  [11, 1, 11,  9,      8, 'a7c2f99571d10ed3d770d1a1692daf91'],
  [11, 1, 13,  1, 112104, '666d12634e828f39f19aff255421bceb'],
  [11, 2,  8,  7,      8, 'd3aff352656129f649a169628b49e93f'],
  [11, 2, 11,  1, 162368, '310a399c0e1227cd27adf937affdb5e9'],
  [11, 3,  5,  2,      8, '0c4d5fe5a4bacc7cc330917cece33ff6'],
  [11, 3, 15,  9, 170576, '54de9001c0a3bc909c442de3fe64e8cb'],
  [11, 4,  1,  5,      8, 'da5712c4fdc5336daf7322f2c3c106a1'],
  [11, 4, 15,  3, 116728, 'f3333f9a7b45a30d20a352ea6ba6d70b'],
  [11, 5,  3, 13,      8, '2cafc9f5bdd41ccd64f2a9a69cf1a49f'],
  [11, 5,  8, 14, 238784, '8f553c10ff469c9c2dbe68709b93d852'],
  [11, 6,  2,  2,      8, '03715ae86707f468a401647f7539f66d'],
  [11, 6, 13, 14, 162520, 'cfbae98f4b676bf40a2beddff035b87c'],
  [12, 1,  7,  1,      8, 'aa9bd24d2b65c61ae5122651e4e69b9c'],
  [12, 1,  0,  7, 206232, '69625790455158c0782c8342b31b3c82'],
  [12, 2, 13,  0,      8, 'f5f3f10208a72617730730651037c71d'],
  [12, 2, 12, 14,  85216, '2c69cbef8617d5d44f9865bd1c336887'],
  [12, 3, 12, 13,      8, '0181fe0f9abb255bcd5dc0b1609b714e'],
  [12, 3, 10,  8,  91864, '7cd28d74aa9a90506ec5e14a472c0094'],
  [12, 4,  5, 15,      8, 'be6e87003f2fc7ad97f1f6a24b94181f'],
  [12, 4,  3,  6,  13296, 'f22aa82a322d8eeac5835944ebdcf5f8'],
  [12, 5, 14, 15,      8, '6c5bd0c21f9aa0f2cf2c00a71da64439'],
  [12, 5,  2, 15, 127128, '2ff102f5838e5a2e5d73af214552ac03'],
  [12, 6, 10, 14,      8, 'd1768bf23e4d5433a74f8a19eccbbd88'],
  [12, 6, 15,  9, 152184, 'dc36000e922135b5ad33356fa2e33f80'],
  [13, 1,  0,  1,      8, 'd5936ff9f94aa63b4eb822e1dd3cb4a2'],
  [13, 1,  9,  7,  32824, '20691577c9f13eece9504d68455de8f4'],
  [13, 2,  7, 12,      8, 'b7448ecc49a2f2e30033aa9a12f7819d'],
  [13, 2,  0,  9, 259496, 'ae74241f4791d891d50b063462bc81d5'],
  [13, 3,  2, 13,      8, '07d5143bfc4dd940fbff434ea85b539a'],
  [13, 3, 12,  2, 101856, '5dd2d48f0c46f061cdc6f4ba874ed84b'],
  [13, 4, 15,  5,      8, 'fef0c58a3ce672917f29f758c804cb66'],
  [13, 4,  2, 11, 140632, '32f0c1c518793475a5e25443b448501a'],
  [13, 5,  4,  2,      8, '861faa4b169da02930625063843be0fd'],
  [13, 5,  7, 10,  69032, '42354a7d9247b6ac4703eefc60216c47'],
  [13, 6, 12,  8,      8, '7d9a1c1f952652b1a63caf476169948d'],
  [13, 6,  5,  6,  94904, 'ab6c26837919444f45d9420e8c439c6d'],
  [14, 1,  4,  0,      8, 'f7f2c26468cec7f6bf0577c14db7c1fc'],
  [14, 1,  8, 13, 106240, 'f28f7012396f0b921c11f0f61f73f49d'],
  [14, 2,  9,  3,      8, 'b2858fc37a35e4adb2c6511cfc32fce8'],
  [14, 2, 15,  7, 141536, '1c64a44dbe6411713d795e32b46b740c'],
  [14, 3,  3,  2,      8, 'f01b0a230def453222247a0f214d5fd4'],
  [14, 3,  1,  4, 207248, 'e653805e77e2c0fe74c535ff0898cde0'],
  [14, 4,  6,  6,      8, '299db94c14bef44307791ebdc488c5b1'],
  [14, 4,  2,  2, 230936, '3d301a614429d322cd50788f1360399f'],
  [14, 5, 10, 15,      8, '80bd661561d6b0e9770303ee6cd0b96a'],
  [14, 5,  6, 15,  56504, '7b6e8fcb149bc3948ecf37491c660c3c'],
  [14, 6,  8, 11,      8, '7b3e5f4d82e17d8ed28250b573d034e1'],
  [14, 6,  9, 10,  93864, 'ca2971289c73b23eefa970b3e6ed8e9d'],
  [15, 1,  7,  0,      8, '64bf4a173b4d5c9cfcb560fa1ef64f8f'],
  [15, 1,  7, 13,  76904, 'ebb356693d10980aa037ded2fb0f3115'],
  [15, 2,  8, 11,      8, '1bc9f6036fcc33ca45cff91c6bd83ac4'],
  [15, 2, 12, 12, 148768, '6862097e46f6be94ff5ecfecf463446c'],
  [15, 3, 13,  4,      8, '4035fa3cb6feb6a169cc8495bd9480f6'],
  [15, 3,  4,  8, 179960, 'b917cb12baabc7a749c88392b80620bc'],
  [15, 4, 12, 12,      8, '9019370f0de5915e8eb4f4e3c0e63f03'],
  [15, 4,  0,  0, 107120, '858507f0ac93a3a9998798ce2bfb87e2'],
  [15, 5,  0, 11,      8, 'ea50f0c76a20a84bf5e98d64750acb99'],
  [15, 5, 11, 11, 114840, '0ce5d54cab2dc9ef2ddcb8ac042fc844'],
  [15, 6, 12,  0,      8, 'b2a154ca29a843255a6cb20bac5d810e'],
  [15, 6, 14, 12, 247000, '6136c7d5a5236097f24b1ae1f81ca4c1'],
  [16, 1, 10,  1,      8, '274015d3ff2e349a31d9b5610d191b75'],
  [16, 1,  1, 11, 113032, '56c9bcbcee78f300fec5cfe26e984a2b'],
  [16, 2, 14,  9,      8, '3fe3dc791507d63984b2528ab8a1ddf7'],
  [16, 2,  7, 10, 234120, '85c9cc314abf57df17677ba18a860f93'],
  [16, 3, 11, 12,      8, 'cf7bbdf05cac9601f11818aaabfac258'],
  [16, 3, 14, 10,  93072, 'd8cc80ceb4ee66c878d303f703b25991'],
  [16, 4, 14,  9,      8, '0fcea6b86f34e40febd63d9d583f7d9e'],
  [16, 4, 15,  7, 261248, '687ff8c9e2d961ccd42f179c34eaf5ec'],
  [16, 5,  8, 15,      8, '7f564f749f537f4e13160803ffd8b009'],
  [16, 5,  5,  6,    584, '9cce329617fcb1f2e62bd0caadefca3a'],
  [16, 6,  8, 14,      8, '0cf8e5e8fc49a573b4a2ae0cf5dd79a2'],
  [16, 6,  8, 10, 161536, 'a78b659348f720aee81414d47ed9a65f'],
  [17, 1, 15,  5,      8, '9946dbb071338ddc31eaa9eae7a9855f'],
  [17, 1,  8, 11,  76800, '3589f9313a8d60685dbc35b1de8053cb'],
  [17, 2, 12, 14,      8, '402d16366552b0e044e39a6414e6bba9'],
  [17, 2, 11,  4, 245336, 'b54728063969bad6a09e12883ea43a0b'],
  [17, 3,  3,  9,      8, '1218ebb5b52817f108538287269b135d'],
  [17, 3, 14,  5,  16080, '0695b6886d2317442f95327ae3ccc0bf'],
  [17, 4, 13, 10,      8, 'd5574fed01cb2ac1890d9deaff0a1287'],
  [17, 4, 13,  7,  80056, 'bc60b3b01871054449723adbf78f9fb1'],
  [17, 5,  1,  4,      8, 'e4ea822b53fc7bd0cb063f75b7b71bdb'],
  [17, 5,  6,  2,  97896, '499958f0bb68065a514aa34da6229669'],
  [17, 6, 15,  0,      8, '30e9cd78f40521bebb65f410a63ead99'],
  [17, 6,  9,  5, 232400, '12768e52b6e92a533ef8cce9e6788d0e'],
  [18, 1,  2, 15,      8, 'dd06185915836a7cf55d78005b4930d0'],
  [18, 1,  9,  5,  62616, 'ee46bf610d7fc136679ab4c34584042f'],
  [18, 2, 12,  2,      8, '33e8cecd0742597aa2efff4f0c2225ba'],
  [18, 2, 15,  7,  85776, '5496bea384c4b66bb66af0eb057886b9'],
  [18, 3,  7,  2,      8, '3ff76f7137dec141897f7fd6b7777700'],
  [18, 3, 12, 13,  65176, '72d742b2f7ce4c21669c8470c54846ef'],
  [18, 4,  6,  6,      8, '2ddede699a3133828f0e82f224b7679c'],
  [18, 4, 10,  4, 254048, '446475327d52cbbe522abef4e583ef18'],
  [18, 5,  2, 13,      8, '2e0ae42d5061e7d1ecc510587c5a09eb'],
  [18, 5,  0,  8,  62248, '0b313d5e1a51e080324f3289bfd5874b'],
  [18, 6, 13, 15,      8, '59711df18a765b38524efdaa7b74bbf1'],
  [18, 6,  1,  3, 240272, '68487526400e6784e65d91fe99c02852'],
  [19, 1,  8, 11,      8, '2973ef25e14cb6c53b54a742262d89ba'],
  [19, 1,  0, 14, 104240, 'ec7f3a2c2a03f488e2ba68f900da0a91'],
  [19, 2, 15, 14,      8, '08e8bb8770723a0963196a20cc6e2b18'],
  [19, 2, 12,  0, 153840, '4f5090c62b06504e21c910a2e97f8fd9'],
  [19, 3, 15,  7,      8, '242d89575bee93ec48511127ae1f09ff'],
  [19, 3, 11,  9,  70200, '900fe857cf1ba44ec3af7023ebd2ac9c'],
  [19, 4,  0, 11,      8, '2d69e80e55cd0f5ab037879f61b1bb5a'],
  [19, 4, 11,  7,  63080, 'b3d8f9475ecd1a9a8e1854ea3e4339f7'],
  [19, 5, 14, 11,      8, 'bdf1330fddfb051f4d75fbcb65c5c6c0'],
  [19, 5, 13,  9,   3408, 'c9a053ef204ed82c6bc7d853adbc8264'],
  [19, 6,  1,  8,      8, '9c8bccde0c80c8db6d2e5ae9e71e5724'],
  [19, 6,  1,  3, 225920, '188a019290a5c32803368b06cc8f648d'],
  [20, 1,  6,  9,      8, '444511974ec94d0df0147ca987b591fb'],
  [20, 1,  6, 12,  18040, '0ab81e82931828c99726f29f9b9687e4'],
  [20, 2,  0,  2,      8, '701148e974bde0086464a2777bf9bf58'],
  [20, 2,  3, 12, 146272, '50851f16251ff87f2529bd8549d9d192'],
  [20, 3, 11,  2,      8, '106de793ff3670db14a37be97046b50c'],
  [20, 3,  6, 13, 118952, '0887a4d1102c9d6ba3ed34348399364c'],
  [20, 4,  8, 14,      8, '3c2c45627a6e36a3b9bd2f2423eb90e9'],
  [20, 4, 15,  3, 109336, 'e1c24097964da075793a4a1e5c0b3117'],
  [20, 5,  5, 15,      8, 'e0260ca01bf59f8141eba45b32c1aabf'],
  [20, 5, 10,  6, 204360, '815d1a4e0e40de3bbe18af3734471e69'],
  [20, 6, 10,  0,      8, 'ae35f0d7e767648c3b63bb6f8a749bc6'],
  [20, 6,  8,  5, 145176, '0cab1776cf0f2618330b0b726f59b98a'],
  [21, 1,  3,  6,      8, 'bf43f9573090c65350d5c08f71665d50'],
  [21, 1,  9,  8,  93992, '1a864af12fcad7541bca6dce1612ed38'],
  [21, 2, 11,  4,      8, '9c20ae148967ca72aa06e74bf71a97dd'],
  [21, 2, 13,  2, 214368, '337c57f2a706bef66d9d1ee1a558c62d'],
  [21, 3,  3, 15,      8, '48f021bf537d7476f1598c15332bd7a5'],
  [21, 3, 12, 12, 251384, 'b90c9d28ac478c3c9f90c059b01867e6'],
  [21, 4,  5,  9,      8, '3c4bb0f1acb29c3b5de0e93d72363235'],
  [21, 4, 14,  8,  74528, '2ea2c61ee32f3c6ebbc4e2f9207cad15'],
  [21, 5, 14,  8,      8, '72c739f04ff02812371641a163551ff2'],
  [21, 5,  7, 13,  28352, 'cb3747147060a6bbee0280eb6485486c'],
  [21, 6, 15,  5,      8, 'd47990bc2d7ed711cafe16ec845e904f'],
  [21, 6,  7,  0,  99016, '4431515aba67e9ac7fd2de5bf92f9c69'],
  [22, 1,  9,  1,      8, '5bff45a4c5f3238be08da73671c2a513'],
  [22, 1, 11,  0,   2784, '9440e0d0bbcdc9a46196a9f6243f8334'],
  [22, 2, 12,  7,      8, 'ad4cd5738522180425b2e06ddac91271'],
  [22, 2,  7,  1,  51296, 'f939968d179bb8754147467cd486dda4'],
  [22, 3,  3, 14,      8, 'f75387b5de4a003fcd4dad4c90dcffd4'],
  [22, 3,  2, 13,  69688, '3edcb60bbcfe94cdf0b87061151f3a1b'],
  [22, 4,  4,  0,      8, '530452174fce99c3af5127c542d2d5d7'],
  [22, 4,  6, 12,  16536, 'd0450db72af8c82bd67d7a5fac70e255'],
  [22, 5, 10, 14,      8, 'e66e4678d2771496fee24c4ec37a8d5a'],
  [22, 5,  4,  9, 242200, 'e9de4e2b014d2f39b544d8700d4563a4'],
  [22, 6, 11, 15,      8, 'a41e65cb031a7708f5e6944fd829367d'],
  [22, 6, 13,  8, 171376, '583a8e4ae9c544f8442ba3ec041e29d2'],
  [23, 1, 15,  5,      8, '430cbd360ca24bdd42e043ec67e485ee'],
  [23, 1, 13,  1, 252184, '682d8c48b3ceb812b1ccaaef7ff62b13'],
  [23, 2,  6,  9,      8, '1d059c12afeb4ebfd2195bd282a90ddd'],
  [23, 2, 11, 12, 150544, 'c2e7745efe93c0cf9af314ed6f434d60'],
  [23, 3,  4,  2,      8, 'c076fc9800c30281b9d7d08a1dc03830'],
  [23, 3,  7,  7, 106616, '5eee426eab4bca725f9d2060da97236f'],
  [23, 4,  9,  2,      8, '780a6ae9e71e9685251495b4a264bc43'],
  [23, 4,  9,  7,  72144, 'ff49b3670e9ff13fb585d251cea44bbe'],
  [23, 5,  9,  3,      8, '204c91836ec6066e9704e5feef73b16e'],
  [23, 5, 10,  5, 239360, '22a5a408f73f4b456df51a72324e5224'],
  [23, 6,  0,  7,      8, 'a3811fa5d75319941391f55bc14a0d1f'],
  [23, 6, 10, 14, 251712, '1e78f9583e639b376f422a4344bf4801'],
  [24, 1, 13, 13,      8, 'a5c2b5f4d1254d1826f7862d0e82de76'],
  [24, 1,  0, 13, 175992, '4183cf25f6640060fefa712fca7cfc0d'],
  [24, 2, 14, 13,      8, 'c2ce1743c4e9ee13cc8c1a368935d9d3'],
  [24, 2,  8,  0, 260800, 'd560024ed4a66bc59612cf4a3d4dd913'],
  [24, 3,  1, 13,      8, '3d0cec5a55ec0107c12b5e6696fd856e'],
  [24, 3,  5, 15,  21296, '930a9c912fae738bd70ca55895a65504'],
  [24, 4,  2,  9,      8, '5f59c5454eee03206b2d1752fe4b8446'],
  [24, 4,  2,  3, 164432, '56c87f72d622b77b35276c846f7c4d79'],
  [24, 5, 13,  9,      8, '4968f6d39f355c41e006b754b436d823'],
  [24, 5,  4, 12,  89816, '93e82c3652f9f963eed72e0d640d9528'],
  [24, 6, 10,  5,      8, '1cd9f45259767305dd7b565bcf9c0359'],
  [24, 6,  3,  1, 164320, 'f2fad94fdb9e4518728cb0a5a5dbe392']
]);
queue.end();
