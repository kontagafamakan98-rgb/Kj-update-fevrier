import os
from PIL import Image, ImageDraw, ImageFont

def create_kojo_icon(size):
    # Create a new image with orange background
    img = Image.new('RGB', (size, size), '#ea580c')
    draw = ImageDraw.Draw(img)
    
    # Calculate font size (approximately 60% of icon size)
    font_size = int(size * 0.6)
    
    try:
        # Try to use a system font, fallback to default if not available
        font = ImageFont.truetype('/System/Library/Fonts/Arial.ttf', font_size)
    except:
        try:
            font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', font_size)
        except:
            font = ImageFont.load_default()
    
    # Get text size
    text = 'K'
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    # Calculate position to center the text
    x = (size - text_width) // 2
    y = (size - text_height) // 2 - bbox[1]
    
    # Draw white 'K' in the center
    draw.text((x, y), text, fill='white', font=font)
    
    return img

# Icon sizes needed for PWA
sizes = [72, 96, 128, 144, 152, 192, 384, 512]

for size in sizes:
    icon = create_kojo_icon(size)
    filename = f'icon-{size}x{size}.png'
    icon.save(filename)
    print(f'Created {filename}')

print('All icons created successfully!')
