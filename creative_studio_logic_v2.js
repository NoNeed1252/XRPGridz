        async function generateCreativeArtwork() {
            const promptInput = document.getElementById('creative-prompt').value.trim();
            const btn = document.getElementById('creative-generate-btn');
            const canvas = document.getElementById('creative-canvas');
            const ctx = canvas.getContext('2d');
            
            if (!activeCreativeImage) return alert("Please select an NFT first.");
            if (!promptInput) return alert("Please enter an artistic prompt.");

            const originalContent = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-sparkles fa-spin"></i> Generating...';

            try {
                // Pollinations.ai Integration
                const seed = Math.floor(Math.random() * 1000000);
                // Enhance the prompt for higher quality and creative interpretation
                const enhancedPrompt = encodeURIComponent(`${promptInput}, cinematic lighting, highly detailed, masterpiece, related to the style of the original NFT image`);
                const imageUrl = `https://image.pollinations.ai/prompt/${enhancedPrompt}?width=1024&height=1024&nologo=true&seed=${seed}`;

                const img = new Image();
                img.crossOrigin = "anonymous";
                
                await new Promise((resolve, reject) => {
                    img.onload = () => {
                        // Maintain square aspect ratio for the studio
                        canvas.width = 1024;
                        canvas.height = 1024;
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        ctx.drawImage(img, 0, 0, 1024, 1024);
                        resolve();
                    };
                    img.onerror = () => {
                        reject(new Error("Failed to load generated image from Pollinations.ai"));
                    };
                    img.src = imageUrl;
                });

            } catch (e) {
                console.error("Creative Studio Error:", e);
                alert("Failed to generate artwork. Falling back to base image.");
                // Fallback: Clear and draw the original NFT back to the canvas
                canvas.width = activeCreativeImage.naturalWidth;
                canvas.height = activeCreativeImage.naturalHeight;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(activeCreativeImage, 0, 0, canvas.width, canvas.height);
            } finally {
                btn.innerHTML = originalContent;
                btn.disabled = false;
            }
        }

        function applyOverlay(ctx, canvas, color) {
            ctx.save();
            ctx.globalAlpha = 1.0;
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
        }

        function drawGlitchEffect(ctx, canvas) {
            for (let i = 0; i < 10; i++) {
                const x = Math.random() * canvas.width;
                const y = Math.random() * canvas.height;
                const w = Math.random() * (canvas.width / 3);
                const h = 5 + Math.random() * 15;
                ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,0,255,0.5)' : 'rgba(0,255,255,0.5)';
                ctx.fillRect(x, y, w, h);
            }
        }

        function drawSparkles(ctx, canvas) {
            ctx.fillStyle = "white";
            for (let i = 0; i < 50; i++) {
                const x = Math.random() * canvas.width;
                const y = Math.random() * canvas.height;
                const size = 1 + Math.random() * 3;
                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
            }
        }
