using System.Buffers.Binary;
using System.Collections.Immutable;
using System.IO.Compression;
using System.Text;
using Wysiwyg.Core;
namespace Folio.Sample;
public static class SampleDocument
{
    public static string Artwork {get;}="data:image/png;base64,"+Convert.ToBase64String(CreateArtwork());
    public static RichDocument Create()
    {
        ParagraphBlock P(string text,ParagraphStyle? style=null,TextStyle? ink=null)=>ParagraphBlock.Create(text,style,ink);
        var table=TableBlock.Create(4,3);var values=new[]{new[]{"Workstream","Owner","Status"},new[]{"Design system","Maya Chen","Ready for review"},new[]{"Editor experience","Alex Rivera","In progress"},new[]{"Release readiness","Jordan Lee","Scheduled"}};
        table=table with {Rows=table.Rows.Select((r,i)=>r with {Cells=r.Cells.Select((c,j)=>c with {Content=P(values[i][j]),Background=i==0?"#EEF0FF":null}).ToImmutableArray()}).ToImmutableArray(),ColumnWidths=[1.5,1,1.3]};
        var introduction=new ParagraphBlock(Guid.NewGuid().ToString("N"),[
            new("A thoughtful workspace for "),new("beautiful documents",new(){Bold=true}),new(". Bring structure to your ideas with rich typography, tables, images and review notes — without leaving the native Avalonia experience.")],new(){SpaceAfter=18});
        var quote=P("Great tools make room for the work, not the other way around.",new(){Quote=true,SpaceBefore=10,SpaceAfter=22},new(){Italic=true,Foreground="#5255A8"});
        return new RichDocument{Title="Product launch brief",Blocks=[
            P("NORTHSTAR  /  PRODUCT STRATEGY",new(){SpaceAfter=12},new(){FontSize=11,Bold=true,Foreground="#6366F1"}),
            P("Ideas into impact.",new(){HeadingLevel=1,SpaceAfter=10}),
            P("A launch brief for a calmer, more connected way to create.",new(){SpaceAfter=20},new(){FontSize=18,Foreground="#64748B"}),
            new ImageBlock(Guid.NewGuid().ToString("N"),Artwork,"Geometric launch artwork",666,145),
            P("A calmer way to create",new(){HeadingLevel=2,SpaceBefore=12,SpaceAfter=12}),introduction,quote,
            P("Launch checklist",new(){HeadingLevel=2,SpaceBefore=8}),
            P("Define the story and align on the audience",new(){List=ListKind.Check,Checked=true,SpaceAfter=7}),
            P("Polish the editing experience across desktop and browser",new(){List=ListKind.Check,SpaceAfter=7}),
            P("Collect feedback and make the final refinements",new(){List=ListKind.Check,SpaceAfter=18}),
            P("The work, at a glance",new(){HeadingLevel=2,SpaceBefore=10}),table,
            P("Built for real content",new(){HeadingLevel=2,SpaceBefore=12}),
            new ParagraphBlock(Guid.NewGuid().ToString("N"),[new("Try editing this document. Select text and use "),new("Ctrl/Cmd+B",new(){Code=true,Background="#EEF0FF"}),new(" to format it, insert a table, or add a comment in the review panel. Your native JSON document preserves formatting and annotations.")],ParagraphStyle.Default),
            P("Unicode belongs here: café · żółw · Ελληνικά · 日本語 · مرحبًا · 👩‍💻",new(){SpaceBefore=10},new(){Foreground="#64748B"}),
            new ParagraphBlock(Guid.NewGuid().ToString("N"),[new("Learn more about Avalonia",new(){Link="https://avaloniaui.net",Underline=true,Foreground="#6366F1"})],new(){SpaceBefore=12})]};
    }
    private static byte[] CreateArtwork()
    {
        const int width=640,height=144;using var pixels=new MemoryStream();
        for(var y=0;y<height;y++)
        {
            pixels.WriteByte(0);
            for(var x=0;x<width;x++)
            {
                var t=(double)x/width;var wave=Math.Sin(x*0.012+y*0.026);var circle=(x-505)*(x-505)+(y-32)*(y-32)<10000;var second=(x-570)*(x-570)+(y-145)*(y-145)<6400;
                var r=(byte)Math.Clamp(227-60*t+8*wave,0,255);var g=(byte)Math.Clamp(231-70*t+5*wave,0,255);var b=(byte)Math.Clamp(251-15*t,0,255);
                if(circle){r=(byte)(r*0.75);g=(byte)(g*0.77);b=(byte)Math.Min(255,b+2);}if(second){r=(byte)Math.Min(255,r+35);g=(byte)Math.Min(255,g+38);b=249;}
                pixels.WriteByte(r);pixels.WriteByte(g);pixels.WriteByte(b);
            }
        }
        using var compressed=new MemoryStream();using(var z=new ZLibStream(compressed,CompressionLevel.SmallestSize,true))z.Write(pixels.ToArray());
        using var png=new MemoryStream();png.Write(new byte[]{137,80,78,71,13,10,26,10});var header=new byte[13];BinaryPrimitives.WriteInt32BigEndian(header,width);BinaryPrimitives.WriteInt32BigEndian(header.AsSpan(4),height);header[8]=8;header[9]=2;
        Chunk("IHDR",header);Chunk("IDAT",compressed.ToArray());Chunk("IEND",[]);return png.ToArray();
        void Chunk(string name,byte[] bytes)
        {
            var length=new byte[4];BinaryPrimitives.WriteInt32BigEndian(length,bytes.Length);png.Write(length);var type=Encoding.ASCII.GetBytes(name);png.Write(type);png.Write(bytes);uint crc=0xffffffff;
            foreach(var b in type.Concat(bytes)){crc^=b;for(var bit=0;bit<8;bit++)crc=(crc&1)!=0?(crc>>1)^0xedb88320:crc>>1;}BinaryPrimitives.WriteUInt32BigEndian(length,crc^0xffffffff);png.Write(length);
        }
    }
}
