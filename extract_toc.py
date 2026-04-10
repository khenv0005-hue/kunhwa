import pypdf
import sys

# Output path
out_path = r'd:\(ai관련)\toc_peek.txt'
pdf_path = r'F:\000. 프로그램\014. hec-ras mapper\HEC-RAS_Mapper_Users_Manual_v6.5.pdf'

with open(out_path, 'w', encoding='utf-8') as f:
    try:
        reader = pypdf.PdfReader(pdf_path)
        total_pages = len(reader.pages)
        f.write(f'Total Pages: {total_pages}\n')
        
        for i in range(min(15, total_pages)):
            text = reader.pages[i].extract_text()
            f.write(f'--- Page {i} ---\n{text}\n')
    except Exception as e:
        f.write(f'Error: {e}\n')
