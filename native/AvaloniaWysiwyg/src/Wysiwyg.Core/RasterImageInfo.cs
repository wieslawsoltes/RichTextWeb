using System.Buffers.Binary;
namespace Wysiwyg.Core;
/// <summary>Read raster dimensions without invoking a native decoder, rejecting decompression-bomb dimensions.</summary>
public readonly record struct RasterImageInfo(int Width,int Height)
{
    public static RasterImageInfo Read(ReadOnlySpan<byte> data)
    {
        int width=0,height=0;
        if(data.Length>=24 && data[..8].SequenceEqual(new byte[]{137,80,78,71,13,10,26,10}))
        {width=checked((int)BinaryPrimitives.ReadUInt32BigEndian(data[16..]));height=checked((int)BinaryPrimitives.ReadUInt32BigEndian(data[20..]));}
        else if(data.Length>=10 && (data[..6].SequenceEqual("GIF87a"u8)||data[..6].SequenceEqual("GIF89a"u8)))
        {width=BinaryPrimitives.ReadUInt16LittleEndian(data[6..]);height=BinaryPrimitives.ReadUInt16LittleEndian(data[8..]);}
        else if(data.Length>=30 && data[..4].SequenceEqual("RIFF"u8) && data.Slice(8,4).SequenceEqual("WEBP"u8))
        {
            if(data.Slice(12,4).SequenceEqual("VP8X"u8)){width=1+U24(data[24..]);height=1+U24(data[27..]);}
            else if(data.Slice(12,4).SequenceEqual("VP8L"u8)&&data[20]==0x2f){var bits=BinaryPrimitives.ReadUInt32LittleEndian(data[21..]);width=(int)(bits&0x3fff)+1;height=(int)((bits>>14)&0x3fff)+1;}
            else if(data.Slice(12,4).SequenceEqual("VP8 "u8)&&data.Slice(23,3).SequenceEqual(new byte[]{0x9d,0x01,0x2a})){width=BinaryPrimitives.ReadUInt16LittleEndian(data[26..])&0x3fff;height=BinaryPrimitives.ReadUInt16LittleEndian(data[28..])&0x3fff;}
        }
        else if(data.Length>=4&&data[0]==255&&data[1]==216)
        {
            var p=2;
            while(p+4<=data.Length)
            {
                if(data[p++]!=255)break;while(p<data.Length&&data[p]==255)p++;if(p>=data.Length)break;var marker=data[p++];
                if(marker is 0xd9 or 0xda)break;if(marker is 0x01 or >=0xd0 and <=0xd7)continue;
                if(p+2>data.Length)break;var length=BinaryPrimitives.ReadUInt16BigEndian(data[p..]);if(length<2||p+length>data.Length)break;
                if(marker is 0xc0 or 0xc1 or 0xc2 or 0xc3 or 0xc5 or 0xc6 or 0xc7 or 0xc9 or 0xca or 0xcb or 0xcd or 0xce or 0xcf)
                {if(length<7)break;height=BinaryPrimitives.ReadUInt16BigEndian(data[(p+3)..]);width=BinaryPrimitives.ReadUInt16BigEndian(data[(p+5)..]);break;}
                p+=length;
            }
        }
        if(width<=0||height<=0||width>8192||height>8192||(long)width*height>16000000)throw new DocumentValidationException("Image dimensions must be at most 8192 pixels per side and 16 million pixels total.");
        return new(width,height);
    }
    private static int U24(ReadOnlySpan<byte> b)=>b[0]|b[1]<<8|b[2]<<16;
}
