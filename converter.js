const dropArea = document.getElementById('drop-area');
const fileInput = document.getElementById('fileInput');
const fileNameDisplay = document.getElementById('file-name-display');
const canvas = document.getElementById('dxfCanvas');
const rotateBtn = document.querySelector('#rotateBtn');
canvas.style.backgroundColor = '#fff';

// Add this variable to track the rotation state
let rotationAngle = 0;

function handleFileUpload(file) {
    const allowedExtensions = ['dxf'];
    const fileName = file.name;
    const fileExtension = fileName.split('.').pop().toLowerCase();

    if (!allowedExtensions.includes(fileExtension)) {
        alert("Invalid file type. Please upload a DXF file.");
        fileInput.value = "";
        fileNameDisplay.textContent = "";
        return;
    }

    fileNameDisplay.textContent = "Selected file: " + fileName;

    const reader = new FileReader();
    reader.onload = function(e) {
        const dxfData = e.target.result;
        renderDXF(dxfData);
    };
    reader.readAsText(file);
}

function calculateDrawingBounds(entities, blocks) {
    const bounds = {
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity
    };
    let hasVisibleEntities = false;

    function ensureValidBounds() {
        if (!isFinite(bounds.minX) || !isFinite(bounds.minY) || 
            !isFinite(bounds.maxX) || !isFinite(bounds.maxY)) {
            bounds.minX = -100;
            bounds.minY = -100;
            bounds.maxX = 100;
            bounds.maxY = 100;
        }
    }

    function processEntity(entity, transform = { x: 0, y: 0, rotation: 0, scale: 1 }) {
        if (!entity || entity.visible === false) return;

        // Handle INSERT entities
        if (entity.type === 'INSERT') {
            const blockName = entity.blockName || entity.name;
            
            if (!blockName) {
                if (entity.position) {
                    updateBounds(
                        entity.position.x + transform.x,
                        entity.position.y + transform.y
                    );
                    hasVisibleEntities = true;
                }
                return;
            }

            const block = blocks?.[blockName] || blocks?.['*Model_Space'];
            if (!block?.entities) {
                if (entity.position) {
                    updateBounds(
                        entity.position.x + transform.x,
                        entity.position.y + transform.y
                    );
                    hasVisibleEntities = true;
                }
                return;
            }

            const insertPoint = entity.position || { x: 0, y: 0 };
            const insertScale = entity.scale || { x: 1, y: 1 };
            const blockTransform = {
                x: transform.x + insertPoint.x,
                y: transform.y + insertPoint.y,
                rotation: transform.rotation + (entity.rotation || 0),
                scale: transform.scale * Math.max(insertScale.x || 1, insertScale.y || 1)
            };

            block.entities.forEach(blockEntity => {
                processEntity(blockEntity, blockTransform);
            });
            return;
        }

        function updateBounds(x, y) {
            if (isFinite(x) && isFinite(y)) {
                bounds.minX = Math.min(bounds.minX, x);
                bounds.minY = Math.min(bounds.minY, y);
                bounds.maxX = Math.max(bounds.maxX, x);
                bounds.maxY = Math.max(bounds.maxY, y);
            }
        }

        function transformPoint(point) {
            const effectiveScale = transform.scale;
            const scaledX = (point?.x || 0) * effectiveScale;
            const scaledY = (point?.y || 0) * effectiveScale;
            const rotatedX = scaledX * Math.cos(transform.rotation) - scaledY * Math.sin(transform.rotation);
            const rotatedY = scaledX * Math.sin(transform.rotation) + scaledY * Math.cos(transform.rotation);
            return {
                x: rotatedX + transform.x,
                y: rotatedY + transform.y
            };
        }

        try {
            switch (entity.type) {
                case 'LINE':
                    if (entity.vertices?.length >= 2) {
                        entity.vertices.forEach(v => {
                            const point = transformPoint(v);
                            updateBounds(point.x, point.y);
                        });
                        hasVisibleEntities = true;
                    }
                    break;

                case 'LWPOLYLINE':
                case 'POLYLINE':
                    if (entity.vertices?.length > 0) {
                        entity.vertices.forEach(v => {
                            const point = transformPoint(v);
                            updateBounds(point.x, point.y);
                        });
                        hasVisibleEntities = true;
                    }
                    break;

                case 'CIRCLE':
                    if (entity.center && entity.radius !== undefined) {
                        const center = transformPoint(entity.center);
                        const radius = entity.radius * transform.scale;
                        updateBounds(center.x - radius, center.y - radius);
                        updateBounds(center.x + radius, center.y + radius);
                        hasVisibleEntities = true;
                    }
                    break;

                    case 'ARC':
                    const arcRadius = (entity.radius * transform.scale);
                    updateBounds(
                        (entity.center.x * transform.scale) + transform.x - arcRadius,
                        (entity.center.y * transform.scale) + transform.y - arcRadius
                    );
                    updateBounds(
                        (entity.center.x * transform.scale) + transform.x + arcRadius,
                        (entity.center.y * transform.scale) + transform.y + arcRadius
                    );
                    hasVisibleEntities = true;
                    break;

                case 'ELLIPSE':
                    if (entity.center && entity.majorAxisEnd && entity.axisRatio !== undefined) {
                        const center = transformPoint(entity.center);
                        const majorVec = transformPoint({
                            x: entity.center.x + entity.majorAxisEnd.x,
                            y: entity.center.y + entity.majorAxisEnd.y
                        });
                        
                        // Calculate major/minor axes
                        const majorLen = Math.sqrt(
                            Math.pow(majorVec.x - center.x, 2) +
                            Math.pow(majorVec.y - center.y, 2)
                        );
                        const minorLen = majorLen * entity.axisRatio;
                        const angle = Math.atan2(
                            majorVec.y - center.y,
                            majorVec.x - center.x
                        );

                        // Parametric points at critical angles
                        [0, Math.PI/2, Math.PI, 3*Math.PI/2].forEach(theta => {
                            const x = majorLen * Math.cos(theta) * Math.cos(angle) - 
                                    minorLen * Math.sin(theta) * Math.sin(angle);
                            const y = majorLen * Math.cos(theta) * Math.sin(angle) + 
                                    minorLen * Math.sin(theta) * Math.cos(angle);
                            updateBounds(center.x + x, center.y + y);
                        });
                        hasVisibleEntities = true;
                    }
                    break;

                case 'SPLINE':
                    if (entity.controlPoints) {
                        entity.controlPoints.forEach(pt => {
                            const point = transformPoint(pt);
                            updateBounds(point.x, point.y);
                        });
                        hasVisibleEntities = true;
                    }
                    break;
            }
        } catch (error) {
            console.warn(`Error processing ${entity.type}:`, error);
        }
    }

    // Helper functions
    function normalizeAngles(start, end) {
        while (end < start) end += 2 * Math.PI;
        return [start % (2*Math.PI), end % (2*Math.PI)];
    }

    function isAngleInRange(angle, start, end) {
        return angle >= start && angle <= end;
    }

    // Process main entities only
    try {
        if (Array.isArray(entities)) {
            entities.forEach(entity => processEntity(entity));
        }
    } catch (error) {
        console.error('Error processing entities:', error);
    }

    ensureValidBounds();
    return { bounds, hasVisibleEntities };
}

// Updated renderDXF function with rotation support
function renderDXF(dxfString) {
    const parser = new DxfParser();
    const ctx = canvas.getContext('2d');
    let dxf;

    try {
        dxf = parser.parseSync(dxfString);
    } catch (error) {
        console.error('Error parsing DXF:', error);
        drawFallbackPreview('Error parsing DXF file');
        return;
    }

    // Clear canvas
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;

    // Initialize blocks if not present
    if (!dxf.blocks) {
        dxf.blocks = {};
    }

    // Get all entities including model space and blocks
    let allEntities = [];
    
    // Add main entities if they exist
    if (dxf.entities && Array.isArray(dxf.entities)) {
        allEntities.push(...dxf.entities);
    }

    // Add entities from model space if they exist
    if (dxf.blocks['*Model_Space']?.entities) {
        allEntities.push(...dxf.blocks['*Model_Space'].entities);
    }

    // Add entities from all other blocks
    Object.values(dxf.blocks).forEach(block => {
        if (block && block.entities && Array.isArray(block.entities)) {
            allEntities.push(...block.entities);
        }
    });

    // Calculate bounds with block support
    const { bounds, hasVisibleEntities } = calculateDrawingBounds(allEntities, dxf.blocks);

    if (!hasVisibleEntities || allEntities.length === 0) {
        drawFallbackPreview('No visible content found in DXF file');
        return;
    }

    const scale = calculateScale(bounds, canvas);
    const offset = calculateOffset(bounds, scale, canvas);

    try {
        // Save the context state
        ctx.save();
        
        // Apply rotation around the center of the canvas
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(1, -1); // Flip vertically
        ctx.rotate(rotationAngle * Math.PI / 180);
        ctx.translate(-canvas.width / 2, -canvas.height / 2);
        
        // Draw the entities with the rotation applied
        drawAllEntities(allEntities, dxf.blocks, ctx, scale, offset);
        
        // Restore the context state
        ctx.restore();
    } catch (error) {
        console.error('Rendering error:', error);
        drawFallbackPreview('Error rendering DXF content');
    }
}

function calculateScale(bounds, canvas) {
    const drawingWidth = bounds.maxX - bounds.minX;
    const drawingHeight = bounds.maxY - bounds.minY;
    const maxDimension = Math.max(drawingWidth, drawingHeight);
    const canvasSize = Math.min(canvas.width, canvas.height);
    return maxDimension > 0 ? (canvasSize * 0.9) / maxDimension : 1;
}

function calculateOffset(bounds, scale, canvas) {
    return {
        x: (canvas.width/2 - (bounds.minX + (bounds.maxX - bounds.minX)/2) * scale),
        y: (canvas.height/2 - (bounds.minY + (bounds.maxY - bounds.minY)/2) * scale)
    };
}

function drawAllEntities(entities, blocks, ctx, scale, offset) {
    ctx.save();
    ctx.translate(offset.x, offset.y);
    const baseLineWidth = 1 / scale;
    ctx.lineWidth = baseLineWidth;
    
    ctx.scale(scale, scale);

    function drawEntity(entity, transform = { x: 0, y: 0, rotation: 0, scale: 1 }) {
        if (entity.visible === false) return;

        if (entity.lineweight && entity.lineweight > 0) {
            ctx.lineWidth = (entity.lineweight / 100) * transform.scale;
        } else {
            ctx.lineWidth = baseLineWidth / transform.scale;
        }

        // Handle blocks/inserts
        if (entity.type === 'INSERT') {
            const block = blocks?.[entity.blockName];
            if (block?.entities) {
                ctx.save();
                ctx.translate(
                    entity.position.x * transform.scale + transform.x,
                    entity.position.y * transform.scale + transform.y
                );
                ctx.rotate((entity.rotation + transform.rotation) * Math.PI / 180);
                const insertScale = entity.scale || { x: 1, y: 1, z: 1 };
                const newScale = transform.scale * Math.max(insertScale.x, insertScale.y);
                
                // Important: don't let the linewidth be affected by scale
                ctx.lineWidth = ctx.lineWidth / newScale;
                
                block.entities.forEach(blockEntity => 
                    drawEntity(blockEntity, {
                        x: 0,
                        y: 0,
                        rotation: 0,
                        scale: newScale
                    })
                );
                ctx.restore();
            }
            return;
        }

        ctx.beginPath();
        const effectiveScale = transform.scale;
        
        switch (entity.type) {
            case 'LINE':
                ctx.moveTo(
                    entity.vertices[0].x * effectiveScale + transform.x,
                    entity.vertices[0].y * effectiveScale + transform.y
                );
                ctx.lineTo(
                    entity.vertices[1].x * effectiveScale + transform.x,
                    entity.vertices[1].y * effectiveScale + transform.y
                );
                break;

            case 'LWPOLYLINE':
            case 'POLYLINE':
                entity.vertices.forEach((v, i) => {
                    const x = v.x * effectiveScale + transform.x;
                    const y = v.y * effectiveScale + transform.y;
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                });
                if (entity.closed) ctx.closePath();
                break;

            case 'CIRCLE':
                ctx.arc(
                    entity.center.x * effectiveScale + transform.x,
                    entity.center.y * effectiveScale + transform.y,
                    entity.radius * effectiveScale,
                    0,
                    2 * Math.PI
                );
                break;

            case 'ARC':
                ctx.arc(
                    entity.center.x * effectiveScale + transform.x,
                    entity.center.y * effectiveScale + transform.y,
                    entity.radius * effectiveScale,
                    (-entity.startAngle) * Math.PI / 180,
                    (-entity.endAngle) * Math.PI / 180,
                    true
                );
                break;

            case 'ELLIPSE':
                const rotation = Math.atan2(
                    entity.majorAxisEndPoint.y,
                    entity.majorAxisEndPoint.x
                );
                const majorAxisLength = Math.sqrt(
                    Math.pow(entity.majorAxisEndPoint.x, 2) +
                    Math.pow(entity.majorAxisEndPoint.y, 2)
                ) * effectiveScale;
                const minorAxisLength = majorAxisLength * entity.axisRatio;

                ctx.save();
                ctx.translate(
                    entity.center.x * effectiveScale + transform.x,
                    entity.center.y * effectiveScale + transform.y
                );
                ctx.rotate(rotation);
                ctx.scale(1, entity.axisRatio);
                ctx.arc(0, 0, majorAxisLength, entity.startParam, entity.endParam, entity.counterClockwise);
                ctx.restore();
                break;

            case 'SPLINE':
                if (entity.controlPoints && entity.controlPoints.length >= 2) {
                    const points = entity.controlPoints.map(p => ({
                        x: p.x * effectiveScale + transform.x,
                        y: p.y * effectiveScale + transform.y
                    }));
                    
                    ctx.moveTo(points[0].x, points[0].y);
                    
                    // Simple curve through points
                    for (let i = 1; i < points.length - 2; i++) {
                        const xc = (points[i].x + points[i + 1].x) / 2;
                        const yc = (points[i].y + points[i + 1].y) / 2;
                        ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
                    }
                    
                    // Curve through the last two points
                    if (points.length > 2) {
                        ctx.quadraticCurveTo(
                            points[points.length - 2].x,
                            points[points.length - 2].y,
                            points[points.length - 1].x,
                            points[points.length - 1].y
                        );
                    }
                }
                break;
        }
        
        ctx.stroke();
    }

    entities.forEach(entity => drawEntity(entity));
    ctx.restore();
}

function drawFallbackPreview(message) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';
    ctx.font = '20px Arial';
    ctx.fillText(message, canvas.width/2, canvas.height/2);
}

function resizeCanvas() {
    const container = canvas.parentElement;
    const size = Math.min(container.clientWidth, container.clientHeight);
    canvas.width = size;
    canvas.height = size;
    canvas.style.marginLeft = 'auto';
    canvas.style.marginRight = 'auto';
    canvas.style.display = 'block';

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (fileInput.files.length > 0) {
        const reader = new FileReader();
        reader.onload = (e) => renderDXF(e.target.result);
        reader.readAsText(fileInput.files[0]);
    }
}

// Style setup
const style = document.createElement('style');
style.textContent = `
    #dxfCanvas {
        max-width: 100%;
        max-height: 80vh;
        margin: auto;
        aspect-ratio: 1;
    }

    .canvas-container {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 600px;
        padding: 20px;
    }
`;
document.head.appendChild(style);

// Call resize on load and window resize
window.addEventListener('load', function() {
    resizeCanvas();
});
window.addEventListener('resize', resizeCanvas);

// Event Listeners
fileInput.addEventListener('change', (e) => {
    if (fileInput.files.length > 0) {
        handleFileUpload(fileInput.files[0]);
    }
});

dropArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropArea.style.borderColor = "green";
});

dropArea.addEventListener('dragleave', () => {
    dropArea.style.borderColor = "#ccc";
});

dropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dropArea.style.borderColor = "#ccc";
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        fileInput.files = files;
        handleFileUpload(files[0]);
    }
});

rotateBtn.addEventListener('click', function() {
    // Increase rotation angle by 90 degrees
    rotationAngle = (rotationAngle + 90) % 360;

    // Re-render the current file with the new rotation
    if (fileInput.files.length > 0) {
        const reader = new FileReader();
        reader.onload = (e) => renderDXF(e.target.result);
        reader.readAsText(fileInput.files[0]);
    }
});

// Download functionality
document.getElementById('downloadBtn').addEventListener('click', function() {
    const format = document.getElementById('format').value;
    const canvas = document.getElementById('dxfCanvas');
    
    // Get the original file name without extension
    let originalFileName = "drawing";
    if (fileInput.files.length > 0) {
        originalFileName = fileInput.files[0].name.split('.')[0];
    }

    if (format === 'png' || format === 'jpg') {
        downloadImage(canvas, format, originalFileName);
    } else if (format === 'pdf') {
        downloadPDF(canvas, originalFileName);
    }
});

function downloadImage(canvas, format, fileName) {
    const image = canvas.toDataURL(`image/${format}`);
    const link = document.createElement('a');
    link.href = image;
    link.download = `${fileName}.${format}`;
    link.click();
}

function downloadPDF(canvas, fileName) {
    const image = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('A4', 'px', [canvas.width, canvas.height]);

    const width = pdf.internal.pageSize.getWidth();
    const height = (canvas.height / canvas.width) * width;

    pdf.addImage(image, 'PNG', 10, 10, width - 20, height - 20);
    pdf.save(`${fileName}.pdf`);
}

document.addEventListener('DOMContentLoaded', function() {
    const banner = document.querySelector('.dxf-banner');
    const container = document.getElementById('dxf-container');
    const bannerHeight = banner.offsetHeight;
    
    // Set the banner height as a CSS variable for spacing
    document.documentElement.style.setProperty('--banner-height', bannerHeight + 'px');
    
    // Add scroll event listener to apply effects
    window.addEventListener('scroll', function() {
        if (window.scrollY > 90) {
            banner.classList.add('blurred');
            container.classList.add('scrolled');
        } else {
            banner.classList.remove('blurred');
            container.classList.remove('scrolled');
        }
    });
});
