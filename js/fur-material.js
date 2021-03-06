import  * as THREE from "./third-party/three.js/build/three.module.js";

const FUR_SHELLS = 16;
const FUR_LENGTH = 0.03;
const GRAVITY = new THREE.Vector3(0, -0.6, 0);

const offsets = [];
for (let i = 1; i <= FUR_SHELLS; ++i) {
  offsets.push(i/FUR_SHELLS);
}
const OFFSET_ATTRIB = new THREE.InstancedBufferAttribute(new Float32Array(offsets), 1);

// Replace with a pre-generated texture
let FUR_TEXTURE = null;
function getFurTexture() {
  if (FUR_TEXTURE) { return FUR_TEXTURE; }
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d', { alpha: true });

  for (let i = 0; i < 15000; ++i) {
    // r = hair 1/0
    // g = length
    // b = darkness
    ctx.fillStyle = "rgba(255," + Math.floor(Math.random() * 127 + 127) + ","+ Math.floor(Math.random() * 255) +",1)";

    ctx.fillRect((Math.random() * canvas.width), (Math.random() * canvas.height), Math.random() * 2, Math.random() * 2);
  }

  FUR_TEXTURE = new THREE.CanvasTexture(canvas, THREE.UVMapping, THREE.RepeatWrapping, THREE.RepeatWrapping);
  return FUR_TEXTURE;
}

export class FurMaterial extends THREE.MeshLambertMaterial {
  constructor(options) {
    super(options);

    const uniforms = {
      hairMap: { value: getFurTexture() },
      furLengthMap: { value: options.furLengthMap },
      gravity: { value: GRAVITY },
      forceDirection: { value: options.forceDirection },
      furLength: { value: FUR_LENGTH }
    };

    if (options.colliders) {
      uniforms.colliders = { value: options.colliders };
    }

    const colliderCount = options.colliders ? options.colliders.length : 0;

    this.onBeforeCompile = (shader, renderer) => {
      for (const uniformName of Object.keys(uniforms)) {
        shader.uniforms[uniformName] = uniforms[uniformName];
      }

      shader.defines = {
        COLLIDERS: !!options.colliders
      };

      // Fur shader inspired by http://oos.moxiecode.com/js_webgl/fur/
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>',`
          #include <common>
          attribute float instanceOffset;
          varying float vOffset;

          uniform float furLength;
          uniform vec3 gravity;
          uniform vec3 forceDirection;
          #ifdef COLLIDERS
          uniform vec4 colliders[${colliderCount}];
          #endif
        `)
        .replace('#include <skinning_vertex>', `
          #include <skinning_vertex>

          vec3 furNormal = normal;

          float shellOffset = instanceOffset * furLength;

          #ifdef COLLIDERS

          vec3 furVertex = transformed + furNormal * shellOffset;

          mat4 invModelMatrix = inverse(modelMatrix);

          for (int i = 0; i < ${colliderCount}; ++i) {
            // Transform colliders into local model space.
            vec3 colliderLocal = (invModelMatrix * vec4(colliders[i].xyz, 1.0)).xyz;
            float colliderInnerRadius = colliders[i].w;
            float colliderOuterRadius = colliders[i].w * 1.5;

            // Project the collider onto the fur normal.
            vec3 ap = colliderLocal-transformed;
            vec3 ab = furVertex-transformed;
            vec3 colliderProjected = transformed + dot(ap,ab)/dot(ab,ab) * ab;
            vec3 pushDir = colliderProjected - colliderLocal;

            // Get the vector from the collider center to the fur shell vertex.
            vec3 posToCollider = furVertex - colliderLocal;

            // Find the distance from the collider to the vertex
            float dist = length(posToCollider);
            if (dist < colliderInnerRadius) {
              // If it's directly under the collider gradually squash the vertex down.
              // This prevents some of the appearance of fair rotating under your fingers.
              float displacementAmount = dist / colliderInnerRadius;
              furVertex += normalize(pushDir) * (colliderInnerRadius - dist) * displacementAmount;
              shellOffset *= displacementAmount;
            } else if (dist < colliderOuterRadius) {
              // If it's near the collider push it out to simulate the fur being pushed aside.
              furVertex += normalize(pushDir) * (colliderOuterRadius - dist);
            }
          }

          // Compute a new fur normal
          furNormal = normalize(furVertex - transformed);

          #endif

          // Account for "gravity", etc.
          vec3 displacement = gravity + forceDirection;
          float displacementFactor = pow(instanceOffset, 1.0);
          furNormal += displacement * displacementFactor;

          transformed = transformed + normalize(furNormal) * shellOffset;

          vOffset = instanceOffset;
        `);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `
          #include <common>
          varying float vOffset;
          uniform sampler2D hairMap;
          uniform sampler2D furLengthMap;
        `)
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
          vec4 hairColor = texture2D(hairMap, vUv*10.0);
          float furLength = hairColor.g * texture2D(furLengthMap, vUv).g;
          // discard no hairs + above the max length
          if (hairColor.a <= 0.0 || furLength < vOffset) {
            discard;
          }
          float furShadow = mix(0.5,hairColor.b*1.2,vOffset);
          vec4 diffuseColor = vec4(diffuse * furShadow, opacity);
        `);
    };
  }

  createMesh(geometry) {
    const instancedGeometry = new THREE.InstancedBufferGeometry();

    // Copy over the geometry's attributes
    Object.keys(geometry.attributes).forEach(attributeName=>{
      instancedGeometry.attributes[attributeName] = geometry.attributes[attributeName];
    })
    instancedGeometry.index = geometry.index;

    instancedGeometry.setAttribute('instanceOffset', OFFSET_ATTRIB);

    instancedGeometry.instancedCount = FUR_SHELLS;
    return new THREE.Mesh(instancedGeometry, this);
  }
}
